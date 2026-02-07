package com.example.calculator;

import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.McpSyncServerExchange;
import io.modelcontextprotocol.spec.McpSchema;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
public class CalculatorTools {

    static final String VIEW_URI = "ui://calculator/view.html";

    public McpServerFeatures.SyncToolSpecification specification() {
        return McpServerFeatures.SyncToolSpecification.builder()
                .tool(toolDefinition())
                .callHandler(this::handle)
                .build();
    }

    private McpSchema.Tool toolDefinition() {
        Map<String, Object> uiMeta = Map.of(
                "ui", Map.of(
                        "resourceUri", VIEW_URI,
                        "visibility", List.of("model", "app")
                ),
                "ui/resourceUri", VIEW_URI
        );

        McpSchema.JsonSchema inputSchema = new McpSchema.JsonSchema(
                "object",
                Map.of(
                        "operation", Map.of(
                                "type", "string",
                                "description", "Math operation: add, subtract, multiply, or divide",
                                "enum", List.of("add", "subtract", "multiply", "divide")
                        ),
                        "a", Map.of(
                                "type", "number",
                                "description", "First operand"
                        ),
                        "b", Map.of(
                                "type", "number",
                                "description", "Second operand"
                        )
                ),
                List.of("operation", "a", "b"),
                false, null, null
        );

        return new McpSchema.Tool(
                "calculate",
                "Calculate",
                "Perform a math operation on two numbers. Supports add, subtract, multiply, and divide.",
                inputSchema,
                null, null, uiMeta
        );
    }

    McpSchema.CallToolResult handle(McpSyncServerExchange exchange, McpSchema.CallToolRequest request) {
        return calculate(request.arguments());
    }

    public McpSchema.CallToolResult calculate(Map<String, Object> arguments) {
        String operation = (String) arguments.get("operation");
        double a = ((Number) arguments.get("a")).doubleValue();
        double b = ((Number) arguments.get("b")).doubleValue();

        double result;
        String symbol;
        switch (operation) {
            case "add" -> { result = a + b; symbol = "+"; }
            case "subtract" -> { result = a - b; symbol = "-"; }
            case "multiply" -> { result = a * b; symbol = "*"; }
            case "divide" -> {
                if (b == 0) {
                    return McpSchema.CallToolResult.builder()
                            .content(List.of(new McpSchema.TextContent("Error: Division by zero")))
                            .isError(true)
                            .build();
                }
                result = a / b;
                symbol = "/";
            }
            default -> {
                return McpSchema.CallToolResult.builder()
                        .content(List.of(new McpSchema.TextContent("Unknown operation: " + operation)))
                        .isError(true)
                        .build();
            }
        }

        String formatted = result == Math.floor(result) && !Double.isInfinite(result)
                ? String.valueOf((long) result)
                : String.valueOf(result);

        String text = String.format("%s %s %s = %s", formatNumber(a), symbol, formatNumber(b), formatted);

        Map<String, Object> structured = Map.of(
                "operation", operation,
                "a", a,
                "b", b,
                "result", result,
                "expression", text
        );

        return McpSchema.CallToolResult.builder()
                .content(List.of(new McpSchema.TextContent(text)))
                .meta(Map.of("structuredContent", structured))
                .build();
    }

    private String formatNumber(double n) {
        return n == Math.floor(n) && !Double.isInfinite(n)
                ? String.valueOf((long) n)
                : String.valueOf(n);
    }
}
