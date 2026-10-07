export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type ErrorDetail = { path: string; message: string };

/** An error whose message is safe to return to API clients. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (resource: string) =>
  new ApiError(404, "NOT_FOUND", `${resource} not found`);

export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);

export const unauthorized = () =>
  new ApiError(401, "UNAUTHORIZED", "Missing or invalid API key");
