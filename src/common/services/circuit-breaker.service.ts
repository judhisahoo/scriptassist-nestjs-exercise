import { Injectable, Logger } from '@nestjs/common';

/**
 * Enumeration of possible circuit breaker states.
 * CLOSED: Normal operation, requests pass through
 * OPEN: Circuit is open, requests are blocked/fail fast
 * HALF_OPEN: Testing phase, limited requests allowed to test recovery
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Configuration options for circuit breaker behavior,
 * defining thresholds and timeouts for failure detection and recovery.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Time in milliseconds to wait before attempting recovery */
  recoveryTimeout: number;
  /** Monitoring period in milliseconds (currently unused) */
  monitoringPeriod: number;
  /** Number of consecutive successes needed to close circuit from HALF_OPEN */
  successThreshold: number;
}

/**
 * Circuit breaker service that prevents cascading failures by temporarily
 * stopping requests to failing services. Implements the classic circuit
 * breaker pattern with CLOSED, OPEN, and HALF_OPEN states.
 *
 * Features:
 * - Automatic failure detection and circuit opening
 * - Configurable failure thresholds and recovery timeouts
 * - Fallback support for graceful degradation
 * - Manual circuit control and monitoring
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  /** Map of circuit breakers by name with their current state and statistics */
  private circuits: Map<
    string,
    {
      state: CircuitState;
      failures: number;
      successes: number;
      lastFailureTime: number;
      config: CircuitBreakerConfig;
    }
  > = new Map();

  /** Default configuration applied to all circuits unless overridden */
  private readonly defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 60000, // 1 minute
    monitoringPeriod: 10000, // 10 seconds
    successThreshold: 3,
  };

  /**
   * Registers a new circuit breaker with optional custom configuration.
   * If no config is provided, default configuration is used.
   *
   * @param circuitName - Unique name for the circuit breaker
   * @param config - Optional configuration overrides for default settings
   */
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

  /**
   * Executes an operation through the circuit breaker with automatic
   * failure detection and fallback support. The circuit breaker will
   * prevent execution if the circuit is OPEN, or allow limited execution
   * if in HALF_OPEN state for testing recovery.
   *
   * @param circuitName - Name of the circuit breaker to use
   * @param operation - Async operation to execute
   * @param fallback - Optional fallback operation if circuit is open or operation fails
   * @returns Result of the operation or fallback
   */
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

  /**
   * Records a successful operation for the circuit breaker.
   * Resets failure count and handles state transitions from HALF_OPEN to CLOSED.
   *
   * @param circuitName - Name of the circuit breaker
   */
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

  /**
   * Records a failed operation for the circuit breaker.
   * Increments failure count and handles state transitions to OPEN when thresholds are exceeded.
   *
   * @param circuitName - Name of the circuit breaker
   */
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

  /**
   * Returns the current state of a circuit breaker.
   *
   * @param circuitName - Name of the circuit breaker
   * @returns Current circuit state or undefined if circuit doesn't exist
   */
  getCircuitState(circuitName: string): CircuitState | undefined {
    return this.circuits.get(circuitName)?.state;
  }

  /**
   * Returns detailed statistics for a specific circuit breaker.
   *
   * @param circuitName - Name of the circuit breaker
   * @returns Circuit statistics including state, failure counts, and configuration
   */
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

  /**
   * Manually resets a circuit breaker to CLOSED state.
   * Useful for administrative control or after fixing underlying issues.
   *
   * @param circuitName - Name of the circuit breaker to reset
   */
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

  /**
   * Returns statistics for all registered circuit breakers.
   *
   * @returns Object mapping circuit names to their statistics
   */
  getAllCircuits() {
    const result: Record<string, any> = {};
    for (const [name, circuit] of this.circuits) {
      result[name] = this.getCircuitStats(name);
    }
    return result;
  }
}