package com.example.calculator;

import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@Component
public class CalculatorResources {

    private String viewHtml;

    @PostConstruct
    public void init() throws IOException {
        ClassPathResource resource = new ClassPathResource("view.html");
        viewHtml = resource.getContentAsString(StandardCharsets.UTF_8);
    }

    public McpServerFeatures.SyncResourceSpecification specification() {
        Map<String, Object> cspMeta = Map.of(
                "ui", Map.of("csp", Map.of("resourceDomains", List.of("https://unpkg.com")))
        );

        McpSchema.Resource resource = new McpSchema.Resource(
                CalculatorTools.VIEW_URI, "view", "Calculator UI", "Calculator interactive UI",
                "text/html;profile=mcp-app", null, null, cspMeta
        );

        return new McpServerFeatures.SyncResourceSpecification(
                resource,
                (exchange, request) -> read()
        );
    }

    public McpSchema.ReadResourceResult read() {
        // CSP metadata must be on each content item, not the result level.
        // See: https://modelcontextprotocol.github.io/ext-apps/docs/patterns#configuring-csp-and-cors
        Map<String, Object> cspMeta = Map.of(
                "ui", Map.of("csp", Map.of("resourceDomains", List.of("https://unpkg.com")))
        );

        return new McpSchema.ReadResourceResult(
                List.of(new McpSchema.TextResourceContents(
                        CalculatorTools.VIEW_URI,
                        "text/html;profile=mcp-app",
                        viewHtml,
                        cspMeta
                ))
        );
    }
}
