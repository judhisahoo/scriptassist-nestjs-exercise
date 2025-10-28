# TaskFlow API Endpoints Documentation

## Overview

This document provides comprehensive documentation for all REST API endpoints available in the TaskFlow task management application. The API is built with NestJS and includes authentication, task management, user management, and health monitoring endpoints.

## Base URL
```
http://localhost:3000
```

## Authentication

All task and user endpoints require JWT authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

---

## Authentication Endpoints

### 1. User Registration
**POST** `/auth/register`

Register a new user account.

**Request Body:**
```json
{
  "email": "john.doe@example.com",
  "name": "John Doe",
  "password": "Password123!"
}
```

**Response (201 Created):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "john.doe@example.com",
    "name": "John Doe"
  }
}
```

**Validation Rules:**
- `email`: Must be a valid email format
- `name`: Required string, non-empty
- `password`: Minimum 6 characters

### 2. User Login
**POST** `/auth/login`

Authenticate user and receive JWT tokens.

**Request Body:**
```json
{
  "email": "john.doe@example.com",
  "password": "Password123!"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "john.doe@example.com",
    "name": "John Doe"
  }
}
```

### 3. Refresh Token
**POST** `/auth/refresh`

Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## Task Management Endpoints

### 1. Create Task
**POST** `/tasks`

Create a new task. Requires authentication.

**Request Body:**
```json
{
  "title": "Complete project documentation",
  "description": "Add details about API endpoints and data models",
  "priority": "HIGH",
  "dueDate": "2025-12-31T23:59:59.000Z",
  "status": "PENDING"
}
```

**Response (201 Created):**
```json
{
  "id": "uuid",
  "title": "Complete project documentation",
  "description": "Add details about API endpoints and data models",
  "status": "PENDING",
  "priority": "HIGH",
  "dueDate": "2025-12-31T23:59:59.000Z",
  "userId": "uuid",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z"
}
```

**Validation Rules:**
- `title`: Required string, non-empty, XSS sanitized
- `description`: Optional string, XSS sanitized
- `priority`: Required enum: `LOW`, `MEDIUM`, `HIGH`, `URGENT`
- `dueDate`: Required ISO date string
- `status`: Optional enum: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `OVERDUE`

### 2. Get All Tasks
**GET** `/tasks`

Retrieve paginated list of tasks with optional filtering. Requires authentication.

**Query Parameters:**
- `status` (optional): Filter by task status (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `OVERDUE`)
- `priority` (optional): Filter by priority (`LOW`, `MEDIUM`, `HIGH`, `URGENT`)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `search` (optional): Search in title and description

**Example Requests:**
```
GET /tasks
GET /tasks?status=PENDING&priority=HIGH
GET /tasks?page=2&limit=20
GET /tasks?search=documentation
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Complete project documentation",
      "description": "Add details about API endpoints and data models",
      "status": "PENDING",
      "priority": "HIGH",
      "dueDate": "2025-12-31T23:59:59.000Z",
      "userId": "uuid",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "count": 1,
  "page": 1,
  "limit": 10
}
```

### 3. Get Task by ID
**GET** `/tasks/:id`

Retrieve a specific task by ID. Requires authentication.

**Path Parameters:**
- `id`: Task UUID

**Response (200 OK):**
```json
{
  "id": "uuid",
  "title": "Complete project documentation",
  "description": "Add details about API endpoints and data models",
  "status": "PENDING",
  "priority": "HIGH",
  "dueDate": "2025-12-31T23:59:59.000Z",
  "userId": "uuid",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z"
}
```

**Error Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Task not found",
  "error": "Not Found"
}
```

### 4. Update Task
**PATCH** `/tasks/:id`

Update an existing task. Requires authentication.

**Path Parameters:**
- `id`: Task UUID

**Request Body (partial update allowed):**
```json
{
  "title": "Updated task title",
  "status": "IN_PROGRESS",
  "priority": "MEDIUM"
}
```

**Response (200 OK):**
```json
{
  "id": "uuid",
  "title": "Updated task title",
  "description": "Add details about API endpoints and data models",
  "status": "IN_PROGRESS",
  "priority": "MEDIUM",
  "dueDate": "2025-12-31T23:59:59.000Z",
  "userId": "uuid",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T11:45:00.000Z"
}
```

### 5. Complete Task
**PATCH** `/tasks/:id/complete`

Mark a task as completed. Requires authentication.

**Path Parameters:**
- `id`: Task UUID

**Response (200 OK):**
```json
{
  "id": "uuid",
  "title": "Complete project documentation",
  "status": "COMPLETED",
  "updatedAt": "2025-01-15T12:00:00.000Z"
}
```

### 6. Delete Task
**DELETE** `/tasks/:id`

Delete a task (currently implemented as complete). Requires authentication.

**Path Parameters:**
- `id`: Task UUID

**Response (200 OK):**
```json
{
  "message": "Task deleted successfully"
}
```

---

## User Management Endpoints

### 1. Create User
**POST** `/users`

Create a new user (admin endpoint).

**Request Body:**
```json
{
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "password": "SecurePass123!"
}
```

### 2. Get All Users
**GET** `/users`

Retrieve all users. Requires authentication.

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "email": "john.doe@example.com",
    "name": "John Doe",
    "createdAt": "2025-01-15T10:00:00.000Z"
  }
]
```

### 3. Get User by ID
**GET** `/users/:id`

Retrieve a specific user. Requires authentication.

**Path Parameters:**
- `id`: User UUID

### 4. Update User
**PATCH** `/users/:id`

Update user information. Requires authentication.

**Path Parameters:**
- `id`: User UUID

### 5. Delete User
**DELETE** `/users/:id`

Delete a user. Requires authentication.

**Path Parameters:**
- `id`: User UUID

---

## Health Check Endpoints

### 1. Basic Health Check
**GET** `/health`

Basic health check for all system components.

**Response (200 OK):**
```json
{
  "status": "ok",
  "info": {
    "memory_heap": {
      "status": "up"
    },
    "memory_rss": {
      "status": "up"
    },
    "database": {
      "status": "up"
    },
    "cache": {
      "status": "up"
    },
    "queue": {
      "status": "up"
    }
  },
  "error": {},
  "details": {
    "memory_heap": {
      "status": "up",
      "used_heap": "45MB",
      "available_heap": "105MB"
    },
    "memory_rss": {
      "status": "up",
      "used_rss": "78MB",
      "available_rss": "72MB"
    },
    "database": {
      "status": "up",
      "database": "taskflow"
    },
    "cache": {
      "status": "up",
      "response_time": "5ms",
      "cache_size": 150
    },
    "queue": {
      "status": "up",
      "waiting": 0,
      "active": 2,
      "completed": 45
    }
  }
}
```

### 2. Detailed Health Check
**GET** `/health/detailed`

Detailed health check with system metrics.

**Response (200 OK):**
```json
{
  "status": "ok",
  "info": { ... },
  "error": {},
  "details": { ... },
  "timestamp": "2025-01-15T12:30:45.123Z",
  "uptime": 3600.5,
  "version": "v18.17.0",
  "environment": "development"
}
```

### 3. Readiness Probe
**GET** `/health/ready`

Kubernetes readiness probe.

**Response (200 OK):**
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "cache": { "status": "up" },
    "queue": { "status": "up" }
  }
}
```

### 4. Liveness Probe
**GET** `/health/live`

Kubernetes liveness probe.

**Response (200 OK):**
```json
{
  "status": "ok",
  "info": {
    "memory_heap": { "status": "up" }
  }
}
```

---

## Error Responses

### Common Error Format
```json
{
  "statusCode": 400,
  "message": [
    "title should not be empty",
    "priority must be one of the following values: LOW, MEDIUM, HIGH, URGENT"
  ],
  "error": "Bad Request"
}
```

### Authentication Errors
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

### Not Found Errors
```json
{
  "statusCode": 404,
  "message": "Task not found",
  "error": "Not Found"
}
```

### Validation Errors
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "details": [
    {
      "field": "email",
      "message": "email must be a valid email"
    }
  ]
}
```

---

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Authenticated endpoints**: 100 requests per minute
- **Authentication endpoints**: 5 requests per 5 minutes
- **Task creation**: 50 requests per hour

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642156800
```

---

## Data Types

### Task Status Enum
- `PENDING`: Task is waiting to be started
- `IN_PROGRESS`: Task is currently being worked on
- `COMPLETED`: Task has been finished
- `OVERDUE`: Task deadline has passed

### Task Priority Enum
- `LOW`: Low priority task
- `MEDIUM`: Medium priority task
- `HIGH`: High priority task
- `URGENT`: Urgent/critical priority task

### User Object
```json
{
  "id": "string (UUID)",
  "email": "string",
  "name": "string",
  "createdAt": "string (ISO date)",
  "updatedAt": "string (ISO date)"
}
```

### Task Object
```json
{
  "id": "string (UUID)",
  "title": "string",
  "description": "string (optional)",
  "status": "TaskStatus",
  "priority": "TaskPriority",
  "dueDate": "string (ISO date)",
  "userId": "string (UUID)",
  "createdAt": "string (ISO date)",
  "updatedAt": "string (ISO date)"
}
```

---

## API Testing Examples

### Using cURL

**Register User:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User",
    "password": "Password123!"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123!"
  }'
```

**Create Task (with JWT token):**
```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Test Task",
    "description": "This is a test task",
    "priority": "HIGH",
    "dueDate": "2025-12-31T23:59:59.000Z"
  }'
```

**Get Tasks:**
```bash
curl -X GET http://localhost:3000/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Health Check:**
```bash
curl -X GET http://localhost:3000/health
```

---

## Performance Considerations

- All endpoints include rate limiting
- Database queries are optimized with proper indexing
- Caching is implemented for frequently accessed data
- Request/response compression is enabled
- Connection pooling is configured for optimal performance

## Security Features

- JWT-based authentication
- Input validation and sanitization
- XSS protection on text inputs
- Rate limiting to prevent abuse
- CORS configuration
- Request logging and monitoring

This documentation covers all available REST API endpoints with their request/response formats, validation rules, and usage examples for the TaskFlow application.