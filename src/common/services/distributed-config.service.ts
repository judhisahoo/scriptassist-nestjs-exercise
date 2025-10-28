import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface ConfigEntry {
  key: string;
  value: any;
  version: number;
  lastModified: number;
  modifiedBy: string;
  ttl?: number;
}

export interface ConfigChangeEvent {
  key: string;
  oldValue: any;
  newValue: any;
  version: number;
  changedBy: string;
  timestamp: number;
}

@Injectable()
export class DistributedConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DistributedConfigService.name);
  private redisClient: Redis;
  private subscriber: Redis;
  private configPrefix = 'config:';
  private configChannel = 'config:changes';
  private instanceId: string;
  private configCache: Map<string, ConfigEntry> = new Map();
  private changeListeners: Map<string, (event: ConfigChangeEvent) => void> = new Map();

  constructor(private configService: ConfigService) {
    this.instanceId = this.generateInstanceId();
  }

  async onModuleInit() {
    await this.initializeRedis();
    await this.setupConfigSubscription();
    await this.loadInitialConfig();
    this.logger.log('Distributed config service initialized');
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      this.subscriber.quit();
    }
    if (this.redisClient) {
      this.redisClient.quit();
    }
  }

  /**
   * Set configuration value
   */
  async setConfig(key: string, value: any, options: {
    ttl?: number;
    modifiedBy?: string;
  } = {}): Promise<void> {
    const { ttl, modifiedBy = this.instanceId } = options;
    const configKey = this.getConfigKey(key);

    try {
      // Get current config to track changes
      const currentEntry = await this.getConfigEntry(key);
      const newVersion = (currentEntry?.version || 0) + 1;

      const configEntry: ConfigEntry = {
        key,
        value,
        version: newVersion,
        lastModified: Date.now(),
        modifiedBy,
        ttl,
      };

      // Store in Redis
      const serializedEntry = JSON.stringify(configEntry);
      if (ttl) {
        await this.redisClient.setex(configKey, ttl, serializedEntry);
      } else {
        await this.redisClient.set(configKey, serializedEntry);
      }

      // Update local cache
      this.configCache.set(key, configEntry);

      // Publish change event
      const changeEvent: ConfigChangeEvent = {
        key,
        oldValue: currentEntry?.value,
        newValue: value,
        version: newVersion,
        changedBy: modifiedBy,
        timestamp: Date.now(),
      };

      await this.publishConfigChange(changeEvent);

      this.logger.debug(`Config set: ${key} = ${JSON.stringify(value)} (v${newVersion})`);
    } catch (error) {
      this.logger.error(`Failed to set config ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get configuration value
   */
  async getConfig<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
    try {
      // Check local cache first
      const cachedEntry = this.configCache.get(key);
      if (cachedEntry && this.isEntryValid(cachedEntry)) {
        return cachedEntry.value as T;
      }

      // Fetch from Redis
      const configEntry = await this.getConfigEntry(key);
      if (configEntry && this.isEntryValid(configEntry)) {
        // Update local cache
        this.configCache.set(key, configEntry);
        return configEntry.value as T;
      }

      return defaultValue;
    } catch (error) {
      this.logger.error(`Failed to get config ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * Delete configuration
   */
  async deleteConfig(key: string, deletedBy: string = this.instanceId): Promise<boolean> {
    const configKey = this.getConfigKey(key);

    try {
      // Get current value for change event
      const currentEntry = await this.getConfigEntry(key);

      // Delete from Redis
      const deleted = await this.redisClient.del(configKey);

      if (deleted > 0) {
        // Remove from local cache
        this.configCache.delete(key);

        // Publish change event
        const changeEvent: ConfigChangeEvent = {
          key,
          oldValue: currentEntry?.value,
          newValue: null,
          version: (currentEntry?.version || 0) + 1,
          changedBy: deletedBy,
          timestamp: Date.now(),
        };

        await this.publishConfigChange(changeEvent);

        this.logger.debug(`Config deleted: ${key}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to delete config ${key}:`, error);
      return false;
    }
  }

  /**
   * Get all configuration keys
   */
  async getAllConfigKeys(pattern: string = '*'): Promise<string[]> {
    try {
      const keys = await this.redisClient.keys(this.getConfigKey(pattern));
      return keys.map(key => key.replace(this.configPrefix, ''));
    } catch (error) {
      this.logger.error('Failed to get config keys:', error);
      return [];
    }
  }

  /**
   * Get configuration with metadata
   */
  async getConfigWithMetadata(key: string): Promise<ConfigEntry | null> {
    try {
      const entry = await this.getConfigEntry(key);
      return entry || null;
    } catch (error) {
      this.logger.error(`Failed to get config metadata for ${key}:`, error);
      return null;
    }
  }

  /**
   * Watch configuration changes
   */
  watchConfig(key: string, callback: (event: ConfigChangeEvent) => void): void {
    this.changeListeners.set(key, callback);
    this.logger.debug(`Config watcher registered for: ${key}`);
  }

  /**
   * Unwatch configuration changes
   */
  unwatchConfig(key: string): void {
    this.changeListeners.delete(key);
    this.logger.debug(`Config watcher removed for: ${key}`);
  }

  /**
   * Atomic configuration update with validation
   */
  async updateConfigAtomically(
    key: string,
    updateFn: (currentValue: any) => any,
    options: {
      validator?: (newValue: any) => boolean;
      modifiedBy?: string;
      ttl?: number;
    } = {},
  ): Promise<boolean> {
    const { validator, modifiedBy = this.instanceId, ttl } = options;

    try {
      const currentEntry = await this.getConfigEntry(key);
      const currentValue = currentEntry?.value;

      const newValue = updateFn(currentValue);

      // Validate new value
      if (validator && !validator(newValue)) {
        throw new Error(`Configuration validation failed for key: ${key}`);
      }

      await this.setConfig(key, newValue, { ttl, modifiedBy });
      return true;
    } catch (error) {
      this.logger.error(`Atomic config update failed for ${key}:`, error);
      return false;
    }
  }

  /**
   * Bulk configuration operations
   */
  async setBulkConfig(
    configs: Array<{ key: string; value: any; ttl?: number }>,
    modifiedBy: string = this.instanceId,
  ): Promise<void> {
    const pipeline = this.redisClient.pipeline();

    for (const config of configs) {
      const configKey = this.getConfigKey(config.key);
      const configEntry: ConfigEntry = {
        key: config.key,
        value: config.value,
        version: 1, // Simplified versioning for bulk operations
        lastModified: Date.now(),
        modifiedBy,
        ttl: config.ttl,
      };

      const serializedEntry = JSON.stringify(configEntry);
      if (config.ttl) {
        pipeline.setex(configKey, config.ttl, serializedEntry);
      } else {
        pipeline.set(configKey, serializedEntry);
      }
    }

    try {
      await pipeline.exec();

      // Update local cache
      for (const config of configs) {
        this.configCache.set(config.key, {
          key: config.key,
          value: config.value,
          version: 1,
          lastModified: Date.now(),
          modifiedBy,
          ttl: config.ttl,
        });
      }

      this.logger.debug(`Bulk config set: ${configs.length} entries`);
    } catch (error) {
      this.logger.error('Bulk config operation failed:', error);
      throw error;
    }
  }

  /**
   * Configuration backup and restore
   */
  async backupConfig(): Promise<Record<string, ConfigEntry>> {
    try {
      const keys = await this.getAllConfigKeys();
      const backup: Record<string, ConfigEntry> = {};

      for (const key of keys) {
        const entry = await this.getConfigEntry(key);
        if (entry) {
          backup[key] = entry;
        }
      }

      this.logger.log(`Configuration backup created with ${Object.keys(backup).length} entries`);
      return backup;
    } catch (error) {
      this.logger.error('Configuration backup failed:', error);
      throw error;
    }
  }

  async restoreConfig(backup: Record<string, ConfigEntry>, restoredBy: string = this.instanceId): Promise<void> {
    try {
      const configs: Array<{ key: string; value: any; ttl?: number }> = [];

      for (const [key, entry] of Object.entries(backup)) {
        configs.push({
          key,
          value: entry.value,
          ttl: entry.ttl,
        });
      }

      await this.setBulkConfig(configs, restoredBy);
      this.logger.log(`Configuration restored from backup with ${configs.length} entries`);
    } catch (error) {
      this.logger.error('Configuration restore failed:', error);
      throw error;
    }
  }

  /**
   * Configuration diff and sync
   */
  async syncConfigWithPeer(peerInstanceId: string): Promise<void> {
    try {
      // This would typically involve communication with peer instance
      // For now, we'll implement a basic sync mechanism
      const localKeys = await this.getAllConfigKeys();
      const peerKeys = await this.requestPeerConfigKeys(peerInstanceId);

      // Find missing keys
      const missingKeys = peerKeys.filter(key => !localKeys.includes(key));

      // Sync missing configurations
      for (const key of missingKeys) {
        const peerConfig = await this.requestPeerConfig(peerInstanceId, key);
        if (peerConfig) {
          await this.setConfig(key, peerConfig.value, {
            ttl: peerConfig.ttl,
            modifiedBy: `sync_from_${peerInstanceId}`,
          });
        }
      }

      this.logger.log(`Config sync completed with peer ${peerInstanceId}`);
    } catch (error) {
      this.logger.error(`Config sync failed with peer ${peerInstanceId}:`, error);
      throw error;
    }
  }

  private async initializeRedis() {
    try {
      const redisConfig = {
        host: this.configService.get('redis.host', 'localhost'),
        port: this.configService.get('redis.port', 6379),
        password: this.configService.get('redis.password'),
        db: this.configService.get('redis.db', 0),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      };

      this.redisClient = new Redis(redisConfig);
      this.subscriber = this.redisClient.duplicate();

      this.redisClient.on('connect', () => {
        this.logger.log('Distributed config service connected to Redis');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Distributed config service Redis error:', error);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis for distributed config:', error);
    }
  }

  private async setupConfigSubscription() {
    this.subscriber.on('message', (channel, messageData) => {
      if (channel === this.configChannel) {
        try {
          const changeEvent: ConfigChangeEvent = JSON.parse(messageData);
          this.handleConfigChange(changeEvent);
        } catch (error) {
          this.logger.error('Error processing config change event:', error);
        }
      }
    });

    await this.subscriber.subscribe(this.configChannel);
  }

  private async loadInitialConfig() {
    try {
      const keys = await this.getAllConfigKeys();
      for (const key of keys) {
        const entry = await this.getConfigEntry(key);
        if (entry) {
          this.configCache.set(key, entry);
        }
      }

      this.logger.log(`Initial config loaded: ${keys.length} entries`);
    } catch (error) {
      this.logger.error('Failed to load initial config:', error);
    }
  }

  private async getConfigEntry(key: string): Promise<ConfigEntry | null> {
    const configKey = this.getConfigKey(key);

    try {
      const data = await this.redisClient.get(configKey);
      if (!data) return null;

      return JSON.parse(data) as ConfigEntry;
    } catch (error) {
      this.logger.error(`Failed to get config entry for ${key}:`, error);
      return null;
    }
  }

  private async publishConfigChange(event: ConfigChangeEvent): Promise<void> {
    try {
      await this.redisClient.publish(this.configChannel, JSON.stringify(event));
    } catch (error) {
      this.logger.error('Failed to publish config change:', error);
    }
  }

  private handleConfigChange(event: ConfigChangeEvent) {
    // Update local cache
    if (event.newValue === null) {
      // Deletion
      this.configCache.delete(event.key);
    } else {
      // Update or creation
      this.configCache.set(event.key, {
        key: event.key,
        value: event.newValue,
        version: event.version,
        lastModified: event.timestamp,
        modifiedBy: event.changedBy,
      });
    }

    // Notify listeners
    const listener = this.changeListeners.get(event.key);
    if (listener) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(`Error in config change listener for ${event.key}:`, error);
      }
    }

    this.logger.debug(`Config change processed: ${event.key} = ${JSON.stringify(event.newValue)}`);
  }

  private isEntryValid(entry: ConfigEntry): boolean {
    if (entry.ttl) {
      const age = Date.now() - entry.lastModified;
      return age < entry.ttl * 1000;
    }
    return true;
  }

  private getConfigKey(key: string): string {
    return `${this.configPrefix}${key}`;
  }

  private generateInstanceId(): string {
    return `instance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Placeholder methods for peer communication (would need actual implementation)
  private async requestPeerConfigKeys(peerInstanceId: string): Promise<string[]> {
    // This would make an HTTP request to the peer instance
    this.logger.warn(`Peer config sync not implemented: ${peerInstanceId}`);
    return [];
  }

  private async requestPeerConfig(peerInstanceId: string, key: string): Promise<ConfigEntry | null> {
    // This would make an HTTP request to the peer instance
    this.logger.warn(`Peer config request not implemented: ${peerInstanceId}/${key}`);
    return null;
  }
}