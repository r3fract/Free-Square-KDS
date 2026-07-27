import type { NextFunction, Request, Response } from "express";

interface HttpError extends Error {
  statusCode?: number;
}

export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(err.stack ?? err.message);
  const statusCode = err.statusCode ?? 500;
  res.status(statusCode).json({ error: err.message ?? "Internal Server Error" });
}
