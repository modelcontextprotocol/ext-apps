pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "basic-host-kotlin"

// Include the MCP Apps Kotlin SDK from the parent project
includeBuild("../../kotlin") {
    dependencySubstitution {
        substitute(module("io.modelcontextprotocol:mcp-apps-kotlin-sdk"))
            .using(project(":"))
    }
}
