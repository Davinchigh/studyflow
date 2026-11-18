# StudyFlow product and design review

## Scope

Reviewed the running dashboard at a narrow 446 px viewport, the React UI and CSS, FastAPI/SQLite implementation, and project setup documentation. This is a design and code inspection, not a user study, screen-reader audit, full browser compatibility pass, penetration test, or deployment assessment. Product fit findings are hypotheses until checked with intended users.

## What is working

- The visual language is coherent: restrained green palette, consistent cards, recognizable status colors, and a clear primary action.
- The dashboard makes task completion, near-term deadlines, estimated work, and subject distribution scannable.
- Task creation has a labelled dialog, validation, keyboard handling, and helpful loading/error states.
- The week view is derived from stored tasks, and overdue counts are surfaced separately.
- The README is candid that the API has no authentication and should remain local. The local Compose ports are bound to loopback.

## Highest-priority findings

### P1 — The product problem and audience are still assumptions

The current project story says it helps students manage coursework, but the interface does not identify a particular student's situation or a specific unmet need. The feature set resembles a general task dashboard. This is a positioning and product-design risk, not a coding defect; no user research has established that the problem or solution is distinctive.

**Next step:** choose a plausible target user and interview or observe a few people who match that description. Find what they do now, where planning breaks down, and what outcome matters. Use that evidence to narrow the product promise before adding features.

### P1 — “Progress insights” mostly describe current totals

Completion percentage, subject totals, an estimated open-task duration, and a seven-day deadline sum are useful status indicators. The workload message is a fixed rule based on due-soon and overdue counts, though, and the interface does not yet create a focused study session or help rebalance a plan. As a result, “insight” and the copy about splitting work into a session suggest more guidance than the product provides.

**Next step:** decide what decision the user should make from an insight. Either keep this as a transparent workload summary, or support one evidence-based action (for example, divide an assignment into scheduled sessions) and measure whether it helps.

### P1 — Deleting a task has no recovery path

The delete icon immediately calls the permanent SQLite delete endpoint. There is no undo, confirmation, or archive. This makes accidental deletion easy and conflicts with user-control and error-recovery principles.

**Next step:** prefer undo or soft-delete/archive for a planner. If deletion remains permanent, use clear confirmation for the consequence and make the action less easy to trigger accidentally.

### P1 before public deployment — All users share one unauthenticated dataset

The API exposes every task without authentication or per-user authorization. That is acceptable only within the documented local-demo boundary. It cannot safely serve multiple people or private academic data as deployed today.

**Next step:** keep the demo local while deciding whether a public portfolio view should use disposable sample data or whether users need accounts and isolated records. If accounts are needed, design authorization and data ownership into the API and schema before deployment; then assess HTTPS, request limits, secrets, and production headers. OWASP's API guidance highlights broken object-level authorization and authentication as major API risks: [OWASP API Security Top 10](https://owasp.org/projects/api-security-project).

## Important design and implementation improvements

### P2 — Mobile section navigation disappears

At widths up to 650 px the CSS hides the entire sidebar navigation. The 446 px view therefore has no visible jump links to tasks or insights, even though the page remains scrollable. The navigation is useful on wide screens but is not adapted for small screens.

**Next step:** provide compact in-page navigation on mobile or make the important sections reachable from a persistent, clearly labelled control.

### P2 — Layout forces a minimum 360 px viewport

The body has `min-width: 360px` in the base and mobile styles. At 320 CSS pixels the page must overflow horizontally. WCAG reflow guidance includes testing at 320 CSS px for typical vertically scrolling content; validate the layout at that width and remove the forced minimum if it is not essential. [WCAG 2.2 Reflow](https://www.w3.org/TR/WCAG22/#reflow).

### P2 — Users cannot edit a saved task

The UI supports adding, completing, and deleting tasks, but not correcting a title, subject, due date, or estimate. The README describes a create/read/update/delete API, but the only update is the completion toggle. Editing is a common recovery path after a plan changes.

**Next step:** add an edit flow if user evidence supports maintaining task details; otherwise describe the API accurately as create/list/toggle/delete.

### P2 — Tiny supporting labels weaken the mobile scan

Some labels such as day counts remain 8 px, with other metadata commonly 9–10 px. They may be hard to read at the narrow size even where color contrast passes. Contrast alone does not make small text comfortable to read.

**Next step:** prioritize readable type sizes for deadline and task metadata, then recheck the card layout at narrow widths and zoom.

### P2 — CSS has no clear source of truth

`styles.css` is largely compressed into long one-line rules, then later overrides several original values, including the root font family. This makes the visual system difficult to understand and increases the chance that a future tweak fixes one viewport while breaking another.

**Next step:** before a visual redesign, format and organize the stylesheet, remove superseded rules, and define a small set of color, spacing, type, and radius tokens. Keep component styles grouped by purpose.

### P2 — Seeded data needs a demo identity

The API silently seeds four example tasks when the database is empty. This helps a first launch look populated, but a user cannot tell whether the tasks are examples or their own, and there is no in-product reset/demo-data control.

**Next step:** label sample data clearly and provide a documented way to reset it, or make onboarding start with an empty state. Confirm the choice with the portfolio demo goal.

## Review of the visual direction

The current design is tidy and familiar, but it reads as a polished generic dashboard template. The visual hierarchy is consistent, yet there is not a distinctive interaction or graphic that communicates why this planner is different. That is not solved by adding decorative animation or more cards. A more original direction should emerge from the user problem and the product's primary workflow.

The existing visual review checked text contrast for selected foreground/background pairs, and manual keyboard interaction of the task dialog was reviewed previously. This does not establish overall WCAG conformance. Automated checks, keyboard review, and a real assistive-technology check answer different questions; WCAG 2.2 is the standard reference. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## Recommended order of work

1. Define the target user, their present workaround, and the specific planning failure we want to solve; validate that with a few short conversations.
2. Write a one-sentence product promise, one primary user journey, and success evidence. Decide whether “progress insights” is a summary or an actionable planning aid.
3. Sketch the key journey and screen states before choosing a new visual style. Review the sketches at mobile and desktop sizes and with keyboard navigation.
4. Decide demo data and user/data boundaries. Keep the current unauthenticated version local; design identity and authorization before any public multi-user service.
5. Implement only the workflow the evidence supports. Improve recovery/editing and mobile navigation as part of the core journey.
6. Re-review with intended users, assistive technology, narrow and wide viewports, and a threat model. Add automated checks that match the real release target.

## References

- [Nielsen Norman Group: 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [GOV.UK Design System patterns](https://design-system.service.gov.uk/patterns/)
- [OWASP API Security Top 10](https://owasp.org/projects/api-security-project)

## Iteration follow-up — 7 October 2026

This section updates the initial findings above after the visual redesign. The prior findings describe the baseline and should be read with these resolutions:

- **Visual direction:** updated to a deep forest-green hero, bright lime action, warm terracotta “up next” task card, stronger type hierarchy, and softer task surfaces. It now feels more intentional than a plain stack of generic cards, but product differentiation still depends on validating the target user's need.
- **Next action:** the dashboard now surfaces the earliest incomplete task with subject, due date, duration, and a link to the task plan. The workload message points to that visible task rather than promising a session-splitting feature.
- **Mobile navigation and width:** a persistent bottom navigation bar is now available below 760 px, follows hash section navigation, and the page minimum width is 320 px. The responsive rules were not directly rendered at 320 px in this pass.
- **Stylesheet:** CSS is formatted, grouped by component, and uses shared color/radius tokens. The app no longer imports Google Fonts remotely.
- **Verified in this iteration:** production build succeeded; the 446 px view and add-task dialog were inspected; Escape closes the dialog and restores focus to its opener. No tasks were created or deleted during review.

Still open from the initial review: establish the target user/problem with evidence; decide whether the workload summary is enough or should support a real planning workflow; add a safe task recovery/edit path if users need it; identify sample data visibly; and keep the unauthenticated API local unless proper user identity and per-user authorization are designed.

## Iteration follow-up — mobile and theme review — 11 October 2026

Reviewed the running preview at a 720 × 472 viewport and followed the Overview, My tasks, and Progress insights navigation in both themes.

- Restored the compact countdown ring on mobile so a running focus block remains visible.
- Kept the seven-day plan, workload summary, recorded focus chart, and subject progress available on mobile. Day and subject cards scroll horizontally without prominent scrollbar tracks.
- Kept the recorded focus chart visible when opening or refreshing the Progress insights anchor directly.
- Corrected Overview copy that said the user had free time when saved tasks were overdue. It now shows the overdue count and says to clear the oldest first; the focus card marks its task overdue.
- Improved dark-theme contrast for section labels, subject cards, task metadata, and task actions.
- Verified the Vite production build and visually rechecked the mobile preview in light and dark themes. Restored the light theme and did not change any task data.

The available preview viewport did not allow a separate wide-desktop or 320 px capture. This pass did not include a screen-reader review or a full WCAG contrast audit.
