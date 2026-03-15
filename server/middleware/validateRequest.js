const formatZodIssues = (issues) => issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message
}));

const validateRequest = (schema, source = 'body') => (req, res, next) => {
    const payload = req[source] || {};
    const result = schema.safeParse(payload);

    if (!result.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: formatZodIssues(result.error.issues)
        });
    }

    req[source] = result.data;
    return next();
};

export default validateRequest;