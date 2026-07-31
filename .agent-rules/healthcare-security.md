# Healthcare Security Rules

Treat all health-related data as highly sensitive.

## Must enforce

- strict authorization on every sensitive route
- ownership/org/grant checks for record access
- least privilege access
- auditability for important state changes
- minimal data collection
- careful logging with redaction/minimization
- short-lived signed URLs for sensitive file access

## Never

- expose secrets to clients
- log sensitive health details casually
- assume authentication alone grants record access
- add extra data collection without feature need
