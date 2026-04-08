package com.example.calculator;

import io.modelcontextprotocol.json.jackson.JacksonMcpJsonMapper;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.server.transport.WebFluxStreamableServerTransportProvider;
import io.modelcontextprotocol.spec.McpSchema;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.server.RouterFunction;

@Configuration
public class McpConfig {

    @Bean
    WebFluxStreamableServerTransportProvider mcpTransportProvider(ObjectMapper mapper) {
        return WebFluxStreamableServerTransportProvider.builder()
                .jsonMapper(new JacksonMcpJsonMapper(mapper))
                .messageEndpoint("/mcp")
                .build();
    }

    @Bean
    RouterFunction<?> mcpRouterFunction(WebFluxStreamableServerTransportProvider transportProvider) {
        return transportProvider.getRouterFunction();
    }

    @Bean
    McpSyncServer mcpServer(WebFluxStreamableServerTransportProvider transportProvider,
                            CalculatorTools tools,
                            CalculatorResources resources,
                            CalculatorPrompts prompts) {
        return McpServer.sync(transportProvider)
                .serverInfo("Calculator", "1.0.0")
                .capabilities(McpSchema.ServerCapabilities.builder()
                        .tools(true)
                        .resources(false, true)
                        .prompts(true)
                        .logging()
                        .build())
                .tools(tools.specification())
                .resources(resources.specification())
                .prompts(prompts.specifications())
                .build();
    }
}
