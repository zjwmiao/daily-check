export function htmlToText(jsdom) {
  const ACC = /H[1-6]|P|LI|TABLE/;
  const REJ = /ASIDE|HEADER|SCRIPT|STYLE/;
  const window = jsdom.window;
  const document = window.document;

  const handlers = {
    h(level, node) {
      return `${"#".repeat(level)} ${node.textContent?.trim()}`;
    },
    TABLE(node) {
      let md = "";
      const rows = node.querySelectorAll("tr");

      rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll("th, td");
        const rowText = Array.from(cells)
          .map((cell) => cell.textContent.trim())
          .join(" | ");
        md += "| " + rowText + " |\n";

        // 在表头后插入分隔线
        if (rowIndex === 0) {
          const separator = Array.from(cells)
            .map(() => "---")
            .join(" | ");
          md += "| " + separator + " |\n";
        }
      });

      return md;
    }
  };

  [1, 2, 3, 4, 5, 6].forEach((lv) => {
    handlers[`H${lv}`] = function (node) {
      return this.h(lv, node);
    };
  });

  const walker = document.createTreeWalker(
    document.body,
    window.NodeFilter.SHOW_ELEMENT,
    (node) => {
      if (REJ.test(node.tagName) || node.parentElement && ACC.test(node.parentElement.tagName))
        return window.NodeFilter.FILTER_REJECT;
      if (
        (node.tagName === "DIV" && node.firstChild?.nodeType === 3) ||
        ACC.test(node.tagName)
      ) {
        return window.NodeFilter.FILTER_ACCEPT;
      }
      return window.NodeFilter.FILTER_SKIP;
    },
  );

  const lines = [];
  while (walker.nextNode()) {
    const curr = walker.currentNode;
    const tagName = curr.tagName;
    const text = handlers[tagName]?.(curr) ?? curr.textContent?.trim();
    if (!text) continue;
    lines.push(text);
  }
  return lines.join("\n\n").trim();
}
