package com.example.calculator;

import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CalculatorToolsTest {

    private CalculatorTools tools;

    @BeforeEach
    void setUp() {
        tools = new CalculatorTools();
    }

    // --- Addition tests ---

    @Test
    void addTwoPositiveIntegers() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "add", "a", 5, "b", 3));

        assertFalse(isError(result));
        assertEquals("5 + 3 = 8", getText(result));
        assertEquals(8.0, getStructuredResult(result));
    }

    @Test
    void addDecimalNumbers() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "add", "a", 1.5, "b", 2.3));

        assertFalse(isError(result));
        assertEquals("1.5 + 2.3 = 3.8", getText(result));
        assertEquals(3.8, getStructuredResult(result));
    }

    @Test
    void addNegativeNumbers() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "add", "a", -5, "b", -3));

        assertFalse(isError(result));
        assertEquals("-5 + -3 = -8", getText(result));
        assertEquals(-8.0, getStructuredResult(result));
    }

    // --- Subtraction tests ---

    @Test
    void subtractTwoNumbers() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "subtract", "a", 10, "b", 4));

        assertFalse(isError(result));
        assertEquals("10 - 4 = 6", getText(result));
        assertEquals(6.0, getStructuredResult(result));
    }

    @Test
    void subtractResultingInNegative() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "subtract", "a", 3, "b", 7));

        assertFalse(isError(result));
        assertEquals("3 - 7 = -4", getText(result));
        assertEquals(-4.0, getStructuredResult(result));
    }

    // --- Multiplication tests ---

    @Test
    void multiplyTwoNumbers() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "multiply", "a", 6, "b", 7));

        assertFalse(isError(result));
        assertEquals("6 * 7 = 42", getText(result));
        assertEquals(42.0, getStructuredResult(result));
    }

    @Test
    void multiplyByZero() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "multiply", "a", 99, "b", 0));

        assertFalse(isError(result));
        assertEquals("99 * 0 = 0", getText(result));
        assertEquals(0.0, getStructuredResult(result));
    }

    // --- Division tests ---

    @Test
    void divideTwoNumbers() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "divide", "a", 10, "b", 4));

        assertFalse(isError(result));
        assertEquals("10 / 4 = 2.5", getText(result));
        assertEquals(2.5, getStructuredResult(result));
    }

    @Test
    void divideEvenly() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "divide", "a", 12, "b", 3));

        assertFalse(isError(result));
        assertEquals("12 / 3 = 4", getText(result));
        assertEquals(4.0, getStructuredResult(result));
    }

    @Test
    void divideByZeroReturnsError() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "divide", "a", 10, "b", 0));

        assertTrue(isError(result));
        assertEquals("Error: Division by zero", getText(result));
        assertNull(result.meta(), "Division by zero should not have structuredContent");
    }

    // --- Unknown operation test ---

    @Test
    void unknownOperationReturnsError() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "modulo", "a", 10, "b", 3));

        assertTrue(isError(result));
        assertEquals("Unknown operation: modulo", getText(result));
        assertNull(result.meta(), "Unknown operation should not have structuredContent");
    }

    // --- Number formatting tests ---

    @Test
    void wholeNumbersDisplayWithoutDecimals() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "add", "a", 2.0, "b", 3.0));

        assertEquals("2 + 3 = 5", getText(result));
    }

    @Test
    void decimalNumbersKeepPrecision() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "add", "a", 1.1, "b", 2.2));

        String text = getText(result);
        assertTrue(text.startsWith("1.1 + 2.2 = "), "Expression should show decimal operands: " + text);
        // 1.1 + 2.2 = 3.3000000000000003 (floating point)
        assertTrue(text.contains("3.3"), "Result should contain 3.3: " + text);
    }

    @Test
    void mixedWholeAndDecimalFormatting() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "multiply", "a", 2.5, "b", 4));

        assertEquals("2.5 * 4 = 10", getText(result));
    }

    // --- structuredContent metadata tests ---

    @Test
    void successfulCallIncludesStructuredContent() {
        McpSchema.CallToolResult result = tools.calculate(
                Map.of("operation", "add", "a", 1, "b", 2));

        assertNotNull(result.meta());
        @SuppressWarnings("unchecked")
        Map<String, Object> structured = (Map<String, Object>) result.meta().get("structuredContent");
        assertNotNull(structured);
        assertEquals("add", structured.get("operation"));
        assertEquals(1.0, structured.get("a"));
        assertEquals(2.0, structured.get("b"));
        assertEquals(3.0, structured.get("result"));
        assertEquals("1 + 2 = 3", structured.get("expression"));
    }

    // --- Tool specification tests ---

    @Test
    void specificationReturnsValidToolSpec() {
        var spec = tools.specification();

        assertNotNull(spec);
        assertEquals("calculate", spec.tool().name());
        assertEquals("Calculate", spec.tool().title());
        assertNotNull(spec.tool().description());
        assertNotNull(spec.tool().inputSchema());
        assertNotNull(spec.tool().meta());
    }

    // --- Helper methods ---

    private String getText(McpSchema.CallToolResult result) {
        return ((McpSchema.TextContent) result.content().get(0)).text();
    }

    private boolean isError(McpSchema.CallToolResult result) {
        return result.isError() != null && result.isError();
    }

    private double getStructuredResult(McpSchema.CallToolResult result) {
        @SuppressWarnings("unchecked")
        Map<String, Object> structured = (Map<String, Object>) result.meta().get("structuredContent");
        return (double) structured.get("result");
    }
}
