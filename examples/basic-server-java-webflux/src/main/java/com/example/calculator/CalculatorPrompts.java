package com.example.calculator;

import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
public class CalculatorPrompts {

    public McpServerFeatures.SyncPromptSpecification[] specifications() {
        return new McpServerFeatures.SyncPromptSpecification[] {
                quickCalc(), compareNumbers(), percentage()
        };
    }

    private McpServerFeatures.SyncPromptSpecification quickCalc() {
        return new McpServerFeatures.SyncPromptSpecification(
                new McpSchema.Prompt("quick-calc", "Quick Calculation",
                        "Evaluate a math expression step by step",
                        List.of(new McpSchema.PromptArgument("expression", "Expression",
                                "Math expression to evaluate (e.g., '245 * 18')", true)),
                        null),
                (exchange, request) -> {
                    String expression = arg(request, "expression", "2 + 2");
                    return new McpSchema.GetPromptResult(
                            "Evaluate a math expression step by step",
                            List.of(
                                    userMessage("Please calculate: " + expression
                                            + "\n\nUse the calculate tool to evaluate this step by step. "
                                            + "If the expression has multiple operations, break it down and show each step."),
                                    assistantMessage("I'll calculate that for you using the calculator. "
                                            + "Let me break it down step by step.")
                            ),
                            null);
                }
        );
    }

    private McpServerFeatures.SyncPromptSpecification compareNumbers() {
        return new McpServerFeatures.SyncPromptSpecification(
                new McpSchema.Prompt("compare-numbers", "Compare Numbers",
                        "Compare two numbers using all four operations",
                        List.of(
                                new McpSchema.PromptArgument("a", "First number", "First number", true),
                                new McpSchema.PromptArgument("b", "Second number", "Second number", true)
                        ),
                        null),
                (exchange, request) -> {
                    String a = arg(request, "a", "10");
                    String b = arg(request, "b", "3");
                    return new McpSchema.GetPromptResult(
                            "Compare two numbers using all four operations",
                            List.of(
                                    userMessage("Compare the numbers " + a + " and " + b
                                            + " by computing all four basic operations: addition, subtraction, "
                                            + "multiplication, and division. Use the calculate tool for each "
                                            + "operation and present the results in a clear summary."),
                                    assistantMessage("I'll run all four operations on " + a + " and " + b
                                            + " using the calculator.")
                            ),
                            null);
                }
        );
    }

    private McpServerFeatures.SyncPromptSpecification percentage() {
        return new McpServerFeatures.SyncPromptSpecification(
                new McpSchema.Prompt("percentage", "Calculate Percentage",
                        "Calculate what percent one number is of another, or find a percentage of a number",
                        List.of(new McpSchema.PromptArgument("question", "Question",
                                "Percentage question (e.g., 'What is 15% of 200?')", true)),
                        null),
                (exchange, request) -> {
                    String question = arg(request, "question", "What is 15% of 200?");
                    return new McpSchema.GetPromptResult(
                            "Calculate a percentage",
                            List.of(
                                    userMessage(question
                                            + "\n\nUse the calculate tool with multiply and divide operations "
                                            + "to solve this percentage problem. Show your work step by step.")
                            ),
                            null);
                }
        );
    }

    private static String arg(McpSchema.GetPromptRequest request, String name, String defaultValue) {
        if (request.arguments() == null) return defaultValue;
        Object value = request.arguments().get(name);
        return value != null ? value.toString() : defaultValue;
    }

    private static McpSchema.PromptMessage userMessage(String text) {
        return new McpSchema.PromptMessage(McpSchema.Role.USER, new McpSchema.TextContent(text));
    }

    private static McpSchema.PromptMessage assistantMessage(String text) {
        return new McpSchema.PromptMessage(McpSchema.Role.ASSISTANT, new McpSchema.TextContent(text));
    }
}
