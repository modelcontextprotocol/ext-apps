package io.modelcontextprotocol.examples;

import io.modelcontextprotocol.json.jackson.JacksonMcpJsonMapperSupplier;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.server.transport.StdioServerTransportProvider;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.eclipse.jetty.ee10.servlet.FilterHolder;
import org.eclipse.jetty.ee10.servlet.ServletContextHandler;
import org.eclipse.jetty.ee10.servlet.ServletHolder;

import java.util.EnumSet;
import java.util.List;

/**
 * Entry point for the inlined-server-java MCP App example.
 *
 * HTTP (default):  java -jar inlined-server-java.jar
 * Stdio:           java -jar inlined-server-java.jar --stdio
 */
public class Main {

    public static void main(String[] args) throws Exception {
        var json = new JacksonMcpJsonMapperSupplier().get();

        if (List.of(args).contains("--stdio")) {
            Server.create(new StdioServerTransportProvider(json));
            return;
        }

        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3001"));
        var transport = HttpServletStatelessServerTransport.builder().jsonMapper(json).build();
        Server.create(transport);

        var context = new ServletContextHandler();
        context.addFilter(new FilterHolder((Filter) (req, res, chain) -> {
            ((HttpServletResponse) res).setHeader("Access-Control-Allow-Origin", "*");
            ((HttpServletResponse) res).setHeader("Access-Control-Allow-Headers", "*");
            if ("OPTIONS".equalsIgnoreCase(((HttpServletRequest) req).getMethod())) {
                ((HttpServletResponse) res).setStatus(200);
                return;
            }
            chain.doFilter(req, res);
        }), "/*", EnumSet.of(DispatcherType.REQUEST));
        context.addServlet(new ServletHolder(transport), "/mcp");

        var server = new org.eclipse.jetty.server.Server(port);
        server.setHandler(context);
        server.start();
        System.out.println("MCP server listening on http://localhost:" + port + "/mcp");
        server.join();
    }
}
