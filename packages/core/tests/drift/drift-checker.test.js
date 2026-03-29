import test from "node:test";
import assert from "node:assert/strict";
import { detectDrift } from "../../src/drift/drift-checker.js";
test("detectDrift reports breaking field removals and optional additions", () => {
    const baseline = {
        title: "API",
        version: "1",
        sourceKind: "openapi",
        sourceLocation: "baseline",
        endpoints: [
            {
                key: "GET /tickets/{id}",
                operationId: "getTicket",
                method: "GET",
                path: "/tickets/{id}",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                    },
                ],
                responseSchema: { ref: "#/components/schemas/Ticket" },
            },
        ],
        schemas: {
            Ticket: {
                type: "object",
                required: ["id", "title"],
                properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                },
            },
        },
        webhookSchemas: {},
    };
    const current = {
        ...baseline,
        sourceLocation: "current",
        schemas: {
            Ticket: {
                type: "object",
                required: ["id", "status"],
                properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    assignee: { type: "string" },
                },
            },
        },
    };
    const report = detectDrift(baseline, current);
    assert.equal(report.breaking.some((item) => item.type === "field_removed"), true);
    assert.equal(report.breaking.some((item) => item.type === "required_field_added"), true);
    assert.equal(report.additions.some((item) => item.type === "field_added"), true);
});
//# sourceMappingURL=drift-checker.test.js.map