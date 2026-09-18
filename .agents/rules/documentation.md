# Component Documentation Rule

Whenever you modify an existing component, add a new feature, or create a new component, you must ensure its documentation is up-to-date. Follow this workflow:

1. **Check for Existing Documentation**: Look in the `docs/` folder (or adjacent to the component) for any existing Markdown documentation related to the component you are working on.
2. **Update Existing**: If documentation exists, you must update it to accurately reflect the changes you made (e.g., changes to architecture, props, data flow, or exported types/functions).
3. **Create Basic Documentation**: If no documentation exists for the component you are significantly modifying or creating, you must create a new basic Markdown file for it (e.g., in the `docs/` folder). This new document should include:
   - A brief overview of the component's purpose.
   - Its primary inputs/props and state.
   - Any critical logic or dependencies.
   - A summary of what it exports.
