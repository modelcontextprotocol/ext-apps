package com.example.calculator;

import io.modelcontextprotocol.spec.McpSchema;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CalculatorResourcesTest {

    private CalculatorResources resources;

    @BeforeEach
    void setUp() throws IOException {
        resources = new CalculatorResources();
        resources.init();
    }

    @Test
    void readReturnsHtmlContent() {
        McpSchema.ReadResourceResult result = resources.read();

        assertNotNull(result.contents());
        assertEquals(1, result.contents().size());

        McpSchema.TextResourceContents contents = (McpSchema.TextResourceContents) result.contents().get(0);
        assertEquals(CalculatorTools.VIEW_URI, contents.uri());
        assertEquals("text/html;profile=mcp-app", contents.mimeType());
        assertTrue(contents.text().contains("<!DOCTYPE html>"), "Should contain HTML content");

        // CSP metadata must be on content items, not result level
        assertNotNull(contents.meta(), "Content item should have _meta with CSP");
        @SuppressWarnings("unchecked")
        Map<String, Object> ui = (Map<String, Object>) contents.meta().get("ui");
        assertNotNull(ui, "Content _meta should have ui key");
        @SuppressWarnings("unchecked")
        Map<String, Object> csp = (Map<String, Object>) ui.get("csp");
        assertNotNull(csp, "Content _meta.ui should have csp key");
        assertNotNull(csp.get("resourceDomains"), "CSP should have resourceDomains");
    }

    @Test
    void specificationReturnsValidResourceSpec() {
        var spec = resources.specification();

        assertNotNull(spec);
        assertEquals(CalculatorTools.VIEW_URI, spec.resource().uri());
        assertEquals("Calculator interactive UI", spec.resource().description());
        assertEquals("text/html;profile=mcp-app", spec.resource().mimeType());
    }
}
