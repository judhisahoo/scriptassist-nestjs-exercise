import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CircuitBreakerService } from '../services/circuit-breaker.service';
import { GracefulDegradationService } from '../services/graceful-degradation.service';
import { SelfHealingService } from '../services/self-healing.service';
import { FaultIsolationService } from '../services/fault-isolation.service';

/**
 * System resilience and health monitoring controller
 * Provides endpoints for monitoring system resilience mechanisms
 * Includes circuit breakers, graceful degradation, self-healing, and fault isolation
 */
@ApiTags('System Health')
@Controller('system-health')
export class SystemHealthController {
  constructor(
    private circuitBreakerService: CircuitBreakerService,
    private gracefulDegradationService: GracefulDegradationService,
    private selfHealingService: SelfHealingService,
    private faultIsolationService: FaultIsolationService,
  ) {}

  /**
   * Get status of all circuit breakers in the system
   * Circuit breakers prevent cascading failures by temporarily stopping calls to failing services
   */
  @Get('circuit-breakers')
  @ApiOperation({ summary: 'Get circuit breaker status' })
  @ApiResponse({ status: 200, description: 'Circuit breaker status retrieved' })
  getCircuitBreakers() {
    return {
      timestamp: new Date().toISOString(),
      circuitBreakers: this.circuitBreakerService.getAllCircuits(),
    };
  }

  /**
   * Get system degradation status and feature availability
   * Shows which features are degraded and overall system health
   */
  @Get('degradation-status')
  @ApiOperation({ summary: 'Get system degradation status' })
  @ApiResponse({ status: 200, description: 'Degradation status retrieved' })
  getDegradationStatus() {
    return {
      timestamp: new Date().toISOString(),
      isDegraded: this.gracefulDegradationService.isSystemDegraded(),
      degradedFeatures: this.gracefulDegradationService.getDegradedFeatures(),
      featureStatus: this.gracefulDegradationService.getFeatureStatus(),
    };
  }

  /**
   * Get self-healing system status and recent healing actions
   * Shows automated recovery attempts and system health monitoring
   */
  @Get('self-healing')
  @ApiOperation({ summary: 'Get self-healing status' })
  @ApiResponse({ status: 200, description: 'Self-healing status retrieved' })
  getSelfHealingStatus() {
    return {
      timestamp: new Date().toISOString(),
      healthStatus: this.selfHealingService.getHealthStatus(),
      healingActions: this.selfHealingService.getHealingActionsStatus(),
    };
  }

  /**
   * Get fault isolation status and boundary health
   * Shows which service boundaries are isolated and domain status
   */
  @Get('fault-isolation')
  @ApiOperation({ summary: 'Get fault isolation status' })
  @ApiResponse({ status: 200, description: 'Fault isolation status retrieved' })
  getFaultIsolationStatus() {
    return {
      timestamp: new Date().toISOString(),
      boundaryStatus: this.faultIsolationService.getBoundaryStatus(),
      domainStatus: this.faultIsolationService.getDomainStatus(),
    };
  }

  /**
   * Get comprehensive system resilience overview
   * Combines all resilience mechanisms with actionable recommendations
   */
  @Get('system-resilience')
  @ApiOperation({ summary: 'Get comprehensive system resilience status' })
  @ApiResponse({ status: 200, description: 'System resilience status retrieved' })
  getSystemResilienceStatus() {
    return {
      timestamp: new Date().toISOString(),
      systemHealth: {
        circuitBreakers: this.circuitBreakerService.getAllCircuits(),
        degradation: {
          isDegraded: this.gracefulDegradationService.isSystemDegraded(),
          degradedFeatures: this.gracefulDegradationService.getDegradedFeatures(),
        },
        selfHealing: this.selfHealingService.getHealthStatus(),
        faultIsolation: this.faultIsolationService.getBoundaryStatus(),
      },
      recommendations: this.generateRecommendations(),
    };
  }

  /**
   * Generate actionable recommendations based on system health
   * Analyzes all resilience mechanisms and provides prioritized recommendations
   * @returns Array of recommendation strings
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const circuitBreakers = this.circuitBreakerService.getAllCircuits();
    const isDegraded = this.gracefulDegradationService.isSystemDegraded();
    const healthStatus = this.selfHealingService.getHealthStatus();
    const boundaryStatus = this.faultIsolationService.getBoundaryStatus();

    // Analyze circuit breaker status
    const openCircuits = Object.entries(circuitBreakers).filter(
      ([, stats]: [string, any]) => stats?.state === 'OPEN'
    );

    if (openCircuits.length > 0) {
      recommendations.push(
        `Circuit breakers open: ${openCircuits.map(([name]) => name).join(', ')}. Consider investigating external service health.`
      );
    }

    // Check system degradation
    if (isDegraded) {
      const degradedFeatures = this.gracefulDegradationService.getDegradedFeatures();
      recommendations.push(
        `System is in degraded mode. Degraded features: ${degradedFeatures.join(', ')}. Monitor system resources and external dependencies.`
      );
    }

    // Analyze health check failures
    const criticalHealthChecks = Object.entries(healthStatus).filter(
      ([, status]: [string, any]) => !status.isHealthy
    );

    if (criticalHealthChecks.length > 0) {
      recommendations.push(
        `Critical health checks failing: ${criticalHealthChecks.map(([name]) => name).join(', ')}. Immediate attention required.`
      );
    }

    // Check fault isolation boundaries
    const isolatedBoundaries = Object.entries(boundaryStatus).filter(
      ([, status]: [string, any]) => status.isolated
    );

    if (isolatedBoundaries.length > 0) {
      recommendations.push(
        `Service boundaries isolated: ${isolatedBoundaries.map(([name]) => name).join(', ')}. Check fault domain status and consider manual recovery.`
      );
    }

    // Default healthy state message
    if (recommendations.length === 0) {
      recommendations.push('System is operating normally. All resilience mechanisms are functioning correctly.');
    }

    return recommendations;
  }
}