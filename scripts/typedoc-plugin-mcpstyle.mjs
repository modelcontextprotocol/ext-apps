/**
 * TypeDoc plugin that applies MCP-specific styling tweaks.
 *
 * - Moves custom.css to load last so overrides win the cascade
 * - Replaces breadcrumbs with the document group name (e.g. "Security")
 * - Marks the current sidebar nav link for CSS highlighting
 */

import { Renderer } from "typedoc";

/**
 * TypeDoc plugin entry point.
 * @param {import('typedoc').Application} app
 */
export function load(app) {
  app.renderer.on(Renderer.EVENT_END_PAGE, (page) => {
    if (!page.contents) return;

    // Move custom.css to load after all theme stylesheets so overrides win the cascade
    const customCssLink = page.contents.match(
      /<link rel="stylesheet" href="[^"]*custom\.css"\/>/,
    );
    if (customCssLink) {
      page.contents = page.contents.replace(customCssLink[0], "");
      page.contents = page.contents.replace(
        "</head>",
        customCssLink[0] + "\n</head>",
      );
    }

    // For document pages, replace the breadcrumb with the group name
    // (e.g. "Security", "Getting Started"). The page title is in the H1.
    if (page.model?.isDocument?.() && page.model.frontmatter?.group) {
      const group = String(page.model.frontmatter.group);
      page.contents = page.contents.replace(
        /<ul class="tsd-breadcrumb"[^>]*>.*?<\/ul>/,
        `<ul class="tsd-breadcrumb" aria-label="Breadcrumb"><li><span>${group}</span></li></ul>`,
      );
    }

    // Inject script to mark the current sidebar nav link with a "current" class.
    // TypeDoc does not natively add this class for document pages.
    // The sidebar is populated asynchronously from compressed navigation data,
    // so we use a MutationObserver to detect when links appear.
    // Pathname comparison strips trailing slashes and .html extensions to handle
    // servers with clean-URL mode (e.g. `serve` drops .html).
    const currentNavScript = `<script>(function(){function norm(s){return s.replace(/\\/$/,"").replace(/\\.html$/,"");}function mark(){var p=norm(location.pathname);var links=document.querySelectorAll(".site-menu .tsd-navigation a[href]");for(var i=0;i<links.length;i++){var h=norm(new URL(links[i].href,location.href).pathname);if(h===p){links[i].classList.add("current");return true;}}return false;}function init(){if(!mark()){var c=document.getElementById("tsd-nav-container");if(c){new MutationObserver(function(m,o){if(mark())o.disconnect();}).observe(c,{childList:true,subtree:true});}}}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",init);}else{init();}})();</script>`;
    page.contents = page.contents.replace(
      "</body>",
      currentNavScript + "\n</body>",
    );
  });
}
