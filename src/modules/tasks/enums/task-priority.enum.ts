/**
 * Enumeration of task priority levels in the task management system
 *
 * This enum establishes a three-tier priority system for task classification and
 * resource allocation. Priority levels help teams focus on the most important work
 * and make informed decisions about task scheduling and resource distribution.
 *
 * Priority levels are used for:
 * - Task queue ordering and scheduling
 * - Resource allocation and workload balancing
 * - Dashboard filtering and visualization
 * - SLA (Service Level Agreement) management
 * - Automated escalation and notification rules
 * - Reporting and analytics on work distribution
 *
 * Priority Guidelines:
 * - HIGH: Critical business impact, immediate customer issues, compliance requirements
 * - MEDIUM: Standard business operations, planned improvements, regular maintenance
 * - LOW: Nice-to-have features, long-term planning, non-urgent improvements
 *
 * @remarks
 * - Used in database schema as enum type for data integrity
 * - Referenced in DTOs for API validation and documentation
 * - Critical for business logic in task scheduling and prioritization
 * - Supports internationalization through string values
 * - MEDIUM is the default priority for new tasks
 */
export enum TaskPriority {
  /**
   * Lowest priority level
   * Tasks that can be addressed when higher priority work is complete
   * Suitable for: long-term planning, minor improvements, non-critical maintenance
   * Typically handled during low-workload periods or by junior team members
   */
  LOW = 'LOW',

  /**
   * Standard priority level (default)
   * Most tasks fall into this category
   * Suitable for: regular business operations, planned features, standard maintenance
   * Represents the baseline priority for normal workflow operations
   */
  MEDIUM = 'MEDIUM',

  /**
   * Highest priority level
   * Requires immediate attention and resources
   * Suitable for: critical issues, customer-impacting problems, compliance matters
   * Triggers escalation procedures and immediate resource allocation
   * May interrupt lower-priority work in progress
   */
  HIGH = 'HIGH',
}
