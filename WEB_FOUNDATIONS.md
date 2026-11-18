# Web design and engineering foundations

This is a practical synthesis for building useful websites, not a claim that one style or stack fits every project. Start with the people, task, constraints, and evidence. Use standards as a floor and adapt patterns to context.

## Product and user experience

- Name the target user, their main task, the context in which they do it, and what success looks like before choosing a layout or framework.
- Use user evidence when available. Expert heuristics are useful for finding likely problems, but they do not replace observing representative users.
- Give each page a clear purpose and information hierarchy. Group related content, use familiar language, and make the next useful action apparent.
- Keep system state visible: loading, saved, errors, empty results, completed, and destructive actions need clear feedback. Give users a way to cancel or recover from mistakes.
- Use patterns that people already understand where they fit. A design system is a source of tested components and guidance, not a reason to copy a different product's visual identity.

## Visual and interaction design

- Establish hierarchy through type scale, weight, spacing, alignment, grouping, and restrained contrast. Apply the same spacing, color, type, radius, and elevation decisions consistently with design tokens.
- Make text readable and content scannable. Use concise headings, labels that remain visible while entering data, meaningful button names, and clear focus indicators.
- Treat responsive design as adapting content and tasks across available space and input modes. Prefer fluid layout and content-led breakpoints over device-specific fixed canvases.
- Respect browser and operating-system preferences such as reduced motion. Do not encode meaning in color alone.
- Review representative pages and states: first visit, populated, empty, loading, validation error, success, keyboard focus, and narrow/wide viewports.

## Accessibility

Use WCAG 2.2 AA as a practical target where applicable, while being explicit that checklists and automated tools do not certify conformance. Structure with semantic HTML first; add ARIA only when native HTML does not express the interaction. Ensure keyboard operation, logical focus order, visible focus, accessible names and labels, helpful validation, adequate contrast, zoom/reflow, and announcements for meaningful dynamic changes. Verify with automation and manual keyboard/assistive-technology checks.

## Architecture and implementation

- Choose the simplest architecture that meets actual functional and quality requirements. A portfolio prototype rarely needs microservices, an elaborate cloud topology, or a speculative scale plan.
- Identify trust boundaries, users/roles, sensitive data, data ownership, external dependencies, and expected failure modes. For any multi-user data, enforce authorization server-side at every object and operation.
- Keep domain rules and data ownership clear. Define HTTP/API contracts, validation, errors, persistence, migrations, and configuration deliberately. Use parameterized database operations and do not trust client validation as a security boundary.
- Evaluate reliability, security, maintainability/operations, performance, and cost together. Record consequential tradeoffs briefly so a reviewer can understand why a choice fits.
- Make local setup reproducible. Keep secrets out of source control; define health checks and meaningful logs; document how to run, configure, back up, and recover the system at a level matching the project.

## Performance and security

- Optimize measured user experience, not guesses. Core Web Vitals currently use LCP (good: <=2.5s), INP (<=200ms), and CLS (<=0.1), judged at the 75th percentile when field data is available. Lab checks help diagnose regressions but do not replace real-user data.
- Use HTTPS for deployed sites, minimal privileges, explicit CORS, secure session/token handling, output encoding, server-side validation, safe dependency updates, security headers, and rate/size limits appropriate to the service.
- Use OWASP Top 10 as awareness guidance, ASVS as a testable requirements catalog, and API Security Top 10 for API-specific risks. None alone proves a system secure. Scope checks to the actual data, users, and deployment model.
- Do not claim a local-only unauthenticated demo is production-ready. State what it protects, what it does not, and what must change before deployment.

## Evidence and sources

- W3C, [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/) and [WAI Forms Tutorial](https://www.w3.org/WAI/tutorials/forms/)
- MDN, [Web standards](https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards), [semantic HTML](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/HTML), and [responsive web design](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design)
- GOV.UK Design System, [styles, components, and patterns](https://design-system.service.gov.uk/)
- Nielsen Norman Group, [10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) and [visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/)
- Google web.dev, [Web Vitals](https://web.dev/articles/vitals)
- OWASP, [Top 10 (2025)](https://owasp.org/projects/top-ten), [ASVS](https://owasp.org/projects/asvs), and [API Security Top 10](https://owasp.org/projects/api-security-project)
- Microsoft Azure Architecture Center, [application architecture fundamentals](https://learn.microsoft.com/en-us/azure/architecture/guide/) and [Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/)

These resources are starting references, not an exhaustive reading list. Standards and threat guidance evolve; check the latest authoritative source when making a current compliance, security, or platform decision.
