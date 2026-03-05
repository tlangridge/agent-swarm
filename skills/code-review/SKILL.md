---
name: code-review
description: Structured code review checklist covering correctness, style, performance, security, and error handling. Use when reviewing code changes.
user-invocable: false
---

# Code Review Checklist

When reviewing code changes, evaluate each area systematically.

## 1. Correctness

- [ ] Does the code do what the task/spec requires?
- [ ] Are edge cases handled (empty inputs, null values, boundary conditions)?
- [ ] Are off-by-one errors avoided in loops and array access?
- [ ] Is async/await used correctly (no missing awaits, no unhandled promise rejections)?
- [ ] Are return types and values correct?
- [ ] Do conditional branches cover all cases?

## 2. Style and Readability

- [ ] Does the code follow existing project conventions and patterns?
- [ ] Are variable and function names descriptive and consistent?
- [ ] Is there unnecessary duplication that should be extracted?
- [ ] Are complex sections commented with "why" not "what"?
- [ ] Is the code organized logically (related functions grouped, clear module boundaries)?

## 3. Performance

- [ ] Are there unnecessary loops or repeated computations?
- [ ] Are database/file operations batched where possible?
- [ ] Are there potential memory leaks (unclosed resources, growing collections)?
- [ ] Is data fetched efficiently (no N+1 queries, appropriate pagination)?
- [ ] Are expensive operations cached when results are reused?

## 4. Security

- [ ] Is user input validated and sanitized?
- [ ] Are secrets kept out of source code (using env vars, not hardcoded)?
- [ ] Are file paths validated to prevent path traversal?
- [ ] Is authentication/authorization checked where required?
- [ ] Are SQL/command injection vectors avoided?

## 5. Error Handling

- [ ] Are errors caught and handled appropriately (not silently swallowed)?
- [ ] Do error messages provide enough context for debugging?
- [ ] Are resources cleaned up in error paths (try/finally, using patterns)?
- [ ] Are external service failures handled gracefully (timeouts, retries, fallbacks)?
- [ ] Are error types specific enough for callers to handle differently?

## 6. Testing

- [ ] Are new features covered by tests?
- [ ] Do tests cover both happy path and error cases?
- [ ] Are tests independent and not relying on shared mutable state?
- [ ] Do test names clearly describe what they verify?

## Review Output Format

When providing review feedback:
1. Start with a brief overall assessment (approve / request changes)
2. List specific issues with file paths and line numbers
3. Categorize each issue (bug, style, performance, security, suggestion)
4. For each issue, explain why it matters and suggest a fix
5. Distinguish between must-fix blockers and nice-to-have suggestions
