import { Injectable, Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  successThreshold: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private circuits: Map<string, {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
    config: CircuitBreakerConfig;
  }> = new Map();

  private readonly defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 60000, // 1 minute
    monitoringPeriod: 10000, // 10 seconds
    successThreshold: 3,
  };

  registerCircuit(circuitName: string, config?: Partial<CircuitBreakerConfig>) {
    const circuitConfig = { ...this.defaultConfig, ...config };
    this.circuits.set(circuitName, {
      state: CircuitState.CLOSED,
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      config: circuitConfig,
    });
    this.logger.log(`Circuit breaker registered: ${circuitName}`);
  }

  async execute<T>(
    circuitName: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    const circuit = this.circuits.get(circuitName);
    if (!circuit) {
      this.registerCircuit(circuitName);
      return this.execute(circuitName, operation, fallback);
    }

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (circuit.state === CircuitState.OPEN) {
      if (Date.now() - circuit.lastFailureTime > circuit.config.recoveryTimeout) {
        circuit.state = CircuitState.HALF_OPEN;
        circuit.successes = 0;
        this.logger.log(`Circuit ${circuitName} transitioned to HALF_OPEN`);
      } else {
        // Circuit is OPEN, use fallback or throw error
        if (fallback) {
          this.logger.warn(`Circuit ${circuitName} is OPEN, using fallback`);
          return fallback();
        }
        throw new Error(`Circuit ${circuitName} is OPEN`);
      }
    }

    try {
      const result = await operation();
      this.recordSuccess(circuitName);
      return result;
    } catch (error) {
      this.recordFailure(circuitName);
      if (fallback) {
        this.logger.warn(`Operation failed for ${circuitName}, using fallback`);
        return fallback();
      }
      throw error;
    }
  }

  private recordSuccess(circuitName: string) {
    const circuit = this.circuits.get(circuitName);
    if (!circuit) return;

    circuit.failures = 0; // Reset failure count on success

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successes++;
      if (circuit.successes >= circuit.config.successThreshold) {
        circuit.state = CircuitState.CLOSED;
        circuit.successes = 0;
        this.logger.log(`Circuit ${circuitName} transitioned to CLOSED`);
      }
    }
  }

  private recordFailure(circuitName: string) {
    const circuit = this.circuits.get(circuitName);
    if (!circuit) return;

    circuit.failures++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.state = CircuitState.OPEN;
      circuit.successes = 0;
      this.logger.warn(`Circuit ${circuitName} transitioned to OPEN (failure in HALF_OPEN)`);
    } else if (
      circuit.state === CircuitState.CLOSED &&
      circuit.failures >= circuit.config.failureThreshold
    ) {
      circuit.state = CircuitState.OPEN;
      this.logger.warn(`Circuit ${circuitName} transitioned to OPEN (failure threshold exceeded)`);
    }
  }

  getCircuitState(circuitName: string): CircuitState | undefined {
    return this.circuits.get(circuitName)?.state;
  }

  getCircuitStats(circuitName: string) {
    const circuit = this.circuits.get(circuitName);
    if (!circuit) return null;

    return {
      state: circuit.state,
      failures: circuit.failures,
      successes: circuit.successes,
      lastFailureTime: circuit.lastFailureTime,
      config: circuit.config,
    };
  }

  resetCircuit(circuitName: string) {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.state = CircuitState.CLOSED;
      circuit.failures = 0;
      circuit.successes = 0;
      circuit.lastFailureTime = 0;
      this.logger.log(`Circuit ${circuitName} manually reset to CLOSED`);
    }
  }

  getAllCircuits() {
    const result: Record<string, any> = {};
    for (const [name, circuit] of this.circuits) {
      result[name] = this.getCircuitStats(name);
    }
    return result;
  }
}