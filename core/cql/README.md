# Chronicle CQL

The Chronicle Query Language: `parse` turns a query into an AST, and
`inferQueryTarget` says whether it asks for entities or actions.
`@chronicle.app/persistence` runs the AST against a store.
