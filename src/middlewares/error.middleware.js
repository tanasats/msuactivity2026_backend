export function notFound(req, res, _next) {
  res.status(404).json({
    status: 'error',
    message: `Not Found: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(err, _req, res, _next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
  });
}
