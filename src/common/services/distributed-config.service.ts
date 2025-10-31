import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Interface representing a configuration entry with metadata.
 * Contains the configuration value along with versioning and audit information.
 */
export interface ConfigEntry {
  /** Configuration key identifier */
  key: string;
  /** The actual configuration value */
  value: any;
  /** Version number for optimistic concurrency control */
  version: number;
  /** Timestamp when the configuration was last modified */
  lastModified: number;
  /** Identifier of the instance/user that made the last modification */
  modifiedBy: string;
  /** Optional time-to-live in seconds */
  ttl?: number;
}

/**
 * Interface representing a configuration change event.
 * Used for broadcasting configuration changes across distributed instances.
 */
export interface ConfigChangeEvent {
  /** The configuration key that changed */
  key: string;
  /** The previous value before the change */
  oldValue: any;
  /** The new value after the change */
  newValue: any;
  /** Version number of the change */
  version: number;
  /** Identifier of who made the change */
  changedBy: string;
  /** Timestamp when the change occurred */
  timestamp: number;
}

/**
 * Service for distributed configuration management across multiple application instances.
 * Provides real-time configuration synchronization, versioning, change tracking, and audit capabilities.
 *
 * @remarks
 * This service supports:
 * - Distributed configuration with Redis backend
 * - Real-time change propagation via pub/sub
 * - Configuration versioning and optimistic locking
 * - Local caching for performance
 * - Change listeners and event-driven updates
 * - Bulk operations and backup/restore
 * - Atomic configuration updates with validation
 */
@Injectable()
export class DistributedConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DistributedConfigService.name);

  /** Redis client for configuration operations */
  private redisClient: Redis;

  /** Separate Redis connection for pub/sub subscriptions */
  private subscriber: Redis;

  /** Prefix for all configuration keys in Redis */
  private configPrefix = 'config:';

  /** Redis pub/sub channel for configuration change events */
  private configChannel = 'config:changes';

  /** Unique identifier for this service instance */
  private instanceId: string;

  /** Local cache of configuration entries for performance */
  private configCache: Map<string, ConfigEntry> = new Map();

  /** Map of registered change listeners by configuration key */
  private changeListeners: Map<string, (event: ConfigChangeEvent) => void> = new Map();

  /**
   * Creates an instance of DistributedConfigService.
   *
   * @param configService - Service for accessing application configuration
   */
  constructor(private configService: ConfigService) {
    this.instanceId = this.generateInstanceId();
  }

  /**
   * Lifecycle hook called when the module is initialized.
   * Sets up Redis connections, subscriptions, and loads initial configuration.
   *
   * @remarks
   * TODO: Add health checks before marking service as ready
   * TODO: Implement graceful startup with retry mechanisms
   * TODO: Add configuration validation during initialization
   */
  async onModuleInit() {
    await this.initializeRedis();
    await this.setupConfigSubscription();
    await this.loadInitialConfig();
    this.logger.log('Distributed config service initialized');
  }

  /**
   * Lifecycle hook called when the module is being destroyed.
   * Ensures proper cleanup of Redis connections and resources.
   *
   * @remarks
   * TODO: Implement graceful shutdown with pending operations handling
   * TODO: Add connection draining before shutdown
   * TODO: Log pending operations during shutdown
   */
  async onModuleDestroy() {
    if (this.subscriber) {
      this.subscriber.quit();
    }
    if (this.redisClient) {
      this.redisClient.quit();
    }
  }

  /**
   * Sets a configuration value with versioning and change tracking.
   * Updates both Redis and local cache, then broadcasts the change to other instances.
   *
   * @param key - Configuration key to set
   * @param value - The configuration value to store
   * @param options - Additional options for the configuration entry
   * @remarks
   * TODO: Implement optimistic locking with version conflict detection
   * TODO: Add data validation and sanitization before storing
   * TODO: Implement configuration schema validation
   * TODO: Add audit logging for sensitive configuration changes
   */
  async setConfig(
    key: string,
    value: any,
    options: {
      ttl?: number;
      modifiedBy?: string;
    } = {},
  ): Promise<void> {
    const { ttl, modifiedBy = this.instanceId } = options;
    const configKey = this.getConfigKey(key);

    try {
      // Get current config to track changes and maintain versioning
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

      // Store in Redis with optional TTL
      const serializedEntry = JSON.stringify(configEntry);
      if (ttl) {
        await this.redisClient.setex(configKey, ttl, serializedEntry);
      } else {
        await this.redisClient.set(configKey, serializedEntry);
      }

      // Update local cache for performance
      this.configCache.set(key, configEntry);

      // Broadcast change event to other instances
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
   * Retrieves a configuration value with local caching for performance.
   * Falls back to Redis if not in local cache or cache entry is invalid.
   *
   * @param key - Configuration key to retrieve
   * @param defaultValue - Default value to return if key not found
   * @returns The configuration value or default value
   * @remarks
   * TODO: Add cache hit/miss metrics and monitoring
   * TODO: Implement cache warming for frequently accessed configs
   * TODO: Add data validation after deserialization
   * TODO: Consider implementing configuration versioning checks
   */
  async getConfig<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
    try {
      // Check local cache first for performance
      const cachedEntry = this.configCache.get(key);
      if (cachedEntry && this.isEntryValid(cachedEntry)) {
        return cachedEntry.value as T;
      }

      // Fetch from Redis if not in cache or cache invalid
      const configEntry = await this.getConfigEntry(key);
      if (configEntry && this.isEntryValid(configEntry)) {
        // Update local cache for future requests
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
   * Deletes a configuration entry and broadcasts the deletion to other instances.
   *
   * @param key - Configuration key to delete
   * @param deletedBy - Identifier of who performed the deletion
   * @returns True if the configuration was deleted, false otherwise
   * @remarks
   * TODO: Add soft delete option with TTL instead of hard delete
   * TODO: Implement deletion audit logging for compliance
   * TODO: Add cascade deletion for dependent configurations
   * TODO: Implement deletion confirmation for critical configurations
   */
  async deleteConfig(key: string, deletedBy: string = this.instanceId): Promise<boolean> {
    const configKey = this.getConfigKey(key);

    try {
      // Get current value for change event tracking
      const currentEntry = await this.getConfigEntry(key);

      // Delete from Redis
      const deleted = await this.redisClient.del(configKey);

      if (deleted > 0) {
        // Remove from local cache
        this.configCache.delete(key);

        // Broadcast deletion event to other instances
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
   * Retrieves all configuration keys matching a pattern.
   * WARNING: Uses KEYS command which can be expensive in production.
   *
   * @param pattern - Redis key pattern (default: '*' for all keys)
   * @returns Array of configuration keys (without prefix)
   * @remarks
   * CRITICAL: KEYS command is blocking and expensive - replace with SCAN
   * TODO: Replace KEYS with SCAN for production use (non-blocking, paginated)
   * TODO: Implement pagination for large key sets
   * TODO: Add rate limiting for key listing operations
   * TODO: Consider implementing key caching for frequently accessed patterns
   */
  async getAllConfigKeys(pattern: string = '*'): Promise<string[]> {
    try {
      // CRITICAL: KEYS command blocks Redis - use SCAN in production
      const keys = await this.redisClient.keys(this.getConfigKey(pattern));
      return keys.map(key => key.replace(this.configPrefix, ''));
    } catch (error) {
      this.logger.error('Failed to get config keys:', error);
      return [];
    }
  }

  /**
   * Retrieves a configuration entry with full metadata (version, timestamps, etc.).
   *
   * @param key - Configuration key to retrieve
   * @returns Complete ConfigEntry object or null if not found
   * @remarks
   * TODO: Add metadata caching for performance
   * TODO: Implement metadata validation and integrity checks
   * TODO: Add metadata access logging for audit purposes
   * TODO: Consider implementing metadata compression for large entries
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
   * Registers a callback to be notified when a specific configuration key changes.
   *
   * @param key - Configuration key to watch
   * @param callback - Function called when the configuration changes
   * @remarks
   * TODO: Add watcher lifecycle management and cleanup
   * TODO: Implement watcher priority and ordering
   * TODO: Add watcher error handling and isolation
   * TODO: Consider implementing watcher debouncing for rapid changes
   */
  watchConfig(key: string, callback: (event: ConfigChangeEvent) => void): void {
    this.changeListeners.set(key, callback);
    this.logger.debug(`Config watcher registered for: ${key}`);
  }

  /**
   * Removes a previously registered configuration change watcher.
   *
   * @param key - Configuration key to stop watching
   * @remarks
   * TODO: Add watcher cleanup verification
   * TODO: Implement watcher statistics and monitoring
   * TODO: Add graceful watcher shutdown handling
   */
  unwatchConfig(key: string): void {
    this.changeListeners.delete(key);
    this.logger.debug(`Config watcher removed for: ${key}`);
  }

  /**
   * Performs an atomic configuration update with validation.
   * Reads current value, applies transformation, validates result, then saves atomically.
   *
   * @param key - Configuration key to update
   * @param updateFn - Function that transforms the current value to new value
   * @param options - Validation and update options
   * @returns True if update succeeded, false otherwise
   * @remarks
   * TODO: Implement optimistic locking to prevent concurrent modifications
   * TODO: Add transaction support for multi-key atomic updates
   * TODO: Implement rollback mechanism for failed validations
   * TODO: Add atomic update metrics and performance monitoring
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

      // Validate new value before saving
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
   * Performs bulk configuration operations using Redis pipelines for efficiency.
   * Sets multiple configuration entries in a single atomic operation.
   *
   * @param configs - Array of configuration entries to set
   * @param modifiedBy - Identifier for who performed the bulk operation
   * @remarks
   * TODO: Add batch size limits to prevent memory issues
   * TODO: Implement transaction rollback on partial failures
   * TODO: Add progress tracking for large bulk operations
   * TODO: Implement bulk operation metrics and performance monitoring
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

      // Update local cache for all entries
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
   * Creates a complete backup of all configuration entries.
   * Useful for disaster recovery and configuration migration.
   *
   * @returns Object containing all configuration entries with metadata
   * @remarks
   * TODO: Implement incremental backups for large configurations
   * TODO: Add backup compression and encryption
   * TODO: Implement backup versioning and retention policies
   * TODO: Add backup operation metrics and monitoring
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

  /**
   * Restores configuration from a backup created by backupConfig().
   * Overwrites existing configurations with backup data.
   *
   * @param backup - Backup object returned by backupConfig()
   * @param restoredBy - Identifier for who performed the restore
   * @remarks
   * TODO: Implement dry-run mode for restore validation
   * TODO: Add restore rollback capability
   * TODO: Implement partial restore for specific keys
   * TODO: Add restore operation audit logging
   */
  async restoreConfig(
    backup: Record<string, ConfigEntry>,
    restoredBy: string = this.instanceId,
  ): Promise<void> {
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
   * Synchronizes configuration with a peer instance.
   * Pulls missing configurations from peer to ensure consistency across instances.
   *
   * @param peerInstanceId - Identifier of the peer instance to sync with
   * @remarks
   * TODO: Implement bidirectional sync (push local changes to peer)
   * TODO: Add conflict resolution for conflicting configurations
   * TODO: Implement incremental sync instead of full comparison
   * TODO: Add sync operation metrics and performance monitoring
   * TODO: Implement sync retry logic and error recovery
   */
  async syncConfigWithPeer(peerInstanceId: string): Promise<void> {
    try {
      // Compare local and peer configuration keys
      const localKeys = await this.getAllConfigKeys();
      const peerKeys = await this.requestPeerConfigKeys(peerInstanceId);

      // Identify configurations missing locally
      const missingKeys = peerKeys.filter(key => !localKeys.includes(key));

      // Sync missing configurations from peer
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