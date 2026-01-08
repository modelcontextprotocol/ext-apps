import SwiftUI
import MCP
import McpApps

struct ContentView: View {
    @StateObject private var viewModel = McpHostViewModel()
    @State private var isInputExpanded = false

    var body: some View {
        content
            .task {
                // Discover available servers on launch
                await viewModel.discoverServers()
            }
    }

    private var content: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Tool calls area (scrollable, like chat)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(viewModel.activeToolCalls) { toolCall in
                                ToolCallCard(
                                    toolCallInfo: toolCall,
                                    onRemove: { Task { await viewModel.removeToolCall(toolCall) } }
                                )
                                .id(toolCall.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: viewModel.activeToolCalls.count) { _ in
                        if let last = viewModel.activeToolCalls.last {
                            withAnimation {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                }

                Divider()

                // Bottom toolbar
                bottomToolbar
            }
            .navigationTitle("MCP Host")
            .navigationBarTitleDisplayMode(.inline)
            .overlay(alignment: .bottom) {
                if let toast = viewModel.toastMessage {
                    Text(toast)
                        .font(.footnote)
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.red.opacity(0.9))
                        .cornerRadius(8)
                        .padding(.bottom, 80) // Above toolbar
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .animation(.easeInOut, value: viewModel.toastMessage)
                }
            }
        }
    }

    // MARK: - Bottom Toolbar

    private var bottomToolbar: some View {
        VStack(spacing: 8) {
            // Expanded input area
            if isInputExpanded {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Input (JSON)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    TextEditor(text: $viewModel.toolInputJson)
                        .font(.system(.caption, design: .monospaced))
                        .frame(height: 80)
                        .padding(4)
                        .background(Color(UIColor.systemGray6))
                        .cornerRadius(6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(isValidJson ? Color.gray.opacity(0.3) : Color.red, lineWidth: 1)
                        )
                }
                .padding(.horizontal)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            // Compact toolbar row
            HStack(spacing: 8) {
                // Server picker
                serverPicker
                    .frame(maxWidth: .infinity)

                // Tool picker (only if connected)
                if viewModel.connectionState == .connected {
                    toolPicker
                        .frame(maxWidth: .infinity)

                    // Expand/collapse button
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            isInputExpanded.toggle()
                        }
                    } label: {
                        Image(systemName: isInputExpanded ? "chevron.down" : "chevron.up")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)

                    // Call button
                    Button("Call") {
                        Task { await viewModel.callTool() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.selectedTool == nil || !isValidJson)
                }

            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(UIColor.systemBackground))
    }

    private var serverPicker: some View {
        Menu {
            if viewModel.isDiscovering {
                Text("Discovering servers...")
            } else if viewModel.discoveredServers.isEmpty {
                Text("No servers found")
            } else {
                ForEach(Array(viewModel.discoveredServers.enumerated()), id: \.offset) { index, server in
                    Button(action: {
                        Task {
                            await viewModel.switchServer(to: index)
                        }
                    }) {
                        HStack {
                            Text(server.name)
                            if viewModel.selectedServerIndex == index && viewModel.connectionState == .connected {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
            Divider()
            Button("Custom URL...") {
                viewModel.selectedServerIndex = -1
                viewModel.connectionState = .disconnected
            }
            Divider()
            Button("Re-scan") {
                Task { await viewModel.discoverServers() }
            }
        } label: {
            HStack {
                Text(serverLabel)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2)
                if viewModel.isDiscovering {
                    ProgressView()
                        .scaleEffect(0.6)
                }
            }
            .font(.caption)
        }
    }

    private var toolPicker: some View {
        Menu {
            ForEach(viewModel.tools, id: \.name) { tool in
                Button(tool.name) {
                    viewModel.selectedTool = tool
                }
            }
        } label: {
            HStack {
                Text(viewModel.selectedTool?.name ?? "Select tool")
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .font(.caption)
        }
        .disabled(viewModel.tools.isEmpty)
    }

    private var serverLabel: String {
        if viewModel.isDiscovering {
            return "Scanning..."
        }
        if viewModel.selectedServerIndex >= 0 && viewModel.selectedServerIndex < viewModel.discoveredServers.count {
            return viewModel.discoveredServers[viewModel.selectedServerIndex].name
        }
        return "Custom"
    }

    private var isValidJson: Bool {
        guard let data = viewModel.toolInputJson.data(using: .utf8) else { return false }
        return (try? JSONSerialization.jsonObject(with: data)) != nil
    }
}

// MARK: - Tool Call Card

struct ToolCallCard: View {
    @ObservedObject var toolCallInfo: ToolCallInfo
    let onRemove: () -> Void

    @State private var isInputExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(toolCallInfo.serverName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(toolCallInfo.tool.name)
                        .font(.subheadline.bold())
                        .foregroundColor(.primary)
                }

                Spacer()

                if toolCallInfo.isTearingDown {
                    HStack(spacing: 4) {
                        ProgressView().scaleEffect(0.6)
                        Text("Closing...")
                            .font(.caption2)
                    }
                    .foregroundColor(.secondary)
                } else {
                    Text(toolCallInfo.state.description)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(stateColor.opacity(0.15))
                        .foregroundColor(stateColor)
                        .cornerRadius(4)

                    Button { withAnimation { isInputExpanded.toggle() } } label: {
                        Image(systemName: isInputExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Button(action: onRemove) {
                        Image(systemName: "xmark")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            // Collapsible input
            if isInputExpanded {
                if let jsonData = try? JSONSerialization.data(withJSONObject: toolCallInfo.input, options: .prettyPrinted),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    Text(jsonString)
                        .font(.system(.caption2, design: .monospaced))
                        .padding(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(UIColor.systemGray6))
                        .cornerRadius(4)
                }
            }

            // Content
            if let error = toolCallInfo.error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.white)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.8))
                    .cornerRadius(6)
            } else if toolCallInfo.state == .ready, toolCallInfo.htmlContent != nil {
                WebViewContainer(toolCallInfo: toolCallInfo)
                    .frame(height: toolCallInfo.preferredHeight)
                    .cornerRadius(6)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.gray.opacity(0.2)))
            } else if toolCallInfo.state == .completed, let result = toolCallInfo.result {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(result.content.enumerated()), id: \.offset) { _, content in
                        switch content {
                        case .text(let text):
                            Text(text)
                                .font(.system(.caption, design: .monospaced))
                                .padding(6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(UIColor.systemGray6))
                                .cornerRadius(4)
                        default:
                            EmptyView()
                        }
                    }
                }
            } else if toolCallInfo.state == .calling || toolCallInfo.state == .loadingUi {
                HStack {
                    ProgressView().scaleEffect(0.7)
                    Text(toolCallInfo.state.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            }
        }
        .padding(10)
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(10)
        .opacity(toolCallInfo.isTearingDown ? 0.5 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: toolCallInfo.isTearingDown)
    }

    private var stateColor: Color {
        switch toolCallInfo.state {
        case .calling, .loadingUi: return .orange
        case .ready, .completed: return .green
        case .error: return .red
        }
    }
}

#Preview {
    ContentView()
}
