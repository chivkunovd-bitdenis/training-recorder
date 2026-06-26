from __future__ import annotations

import html
import io
import logging
import re
import zipfile
from typing import Any

logger = logging.getLogger(__name__)

SECTION_PURPOSE = "Назначение"
SECTION_AUDIENCE = "Кому предназначена инструкция"
SECTION_PREREQUISITES = "Перед началом"
SECTION_STEPS = "Шаги"
SECTION_WARNINGS = "Частые ошибки"
SECTION_RESULT = "Ожидаемый результат"


def screenshot_relative_path(screenshot_id: str | None) -> str | None:
    if not screenshot_id:
        return None
    safe_id = screenshot_id.strip()
    if not safe_id:
        return None
    return f"screenshots/{safe_id}.jpg"


def export_step_image_path(step_id: str) -> str:
    safe_id = re.sub(r"[^\w.-]+", "_", step_id.strip()) or "step"
    return f"screenshots/{safe_id}.png"


def slugify_filename(title: str, fallback: str = "instruction") -> str:
    slug = re.sub(r"[^\w\s-]", "", title.strip(), flags=re.UNICODE)
    slug = re.sub(r"[-\s]+", "-", slug).strip("-").lower()
    ascii_slug = slug.encode("ascii", "ignore").decode("ascii").strip("-")
    if ascii_slug:
        return ascii_slug[:80]
    return fallback


def _step_heading(index: int, title: str) -> str:
    return f"{index}. {title.strip()}"


def _markdown_image(alt: str, path: str) -> str:
    escaped_alt = alt.replace("[", "\\[")
    return f"![{escaped_alt}]({path})"


def _step_image_path(
    step: dict[str, Any],
    *,
    step_image_paths: dict[str, str] | None = None,
    inline_image_data: dict[str, str] | None = None,
) -> str | None:
    step_id = str(step.get("id", "")).strip()
    if inline_image_data and step_id in inline_image_data:
        return inline_image_data[step_id]
    if step_image_paths and step_id in step_image_paths:
        return step_image_paths[step_id]
    screenshot_id = step.get("screenshotId")
    if screenshot_id:
        return screenshot_relative_path(str(screenshot_id))
    return None


def render_markdown(
    doc: dict[str, Any],
    *,
    screenshots_base: str = "screenshots",
    step_image_paths: dict[str, str] | None = None,
) -> str:
    """Собрать Markdown-инструкцию из GeneratedDoc."""
    _ = screenshots_base

    lines: list[str] = [
        f"# {doc['title'].strip()}",
        "",
        f"## {SECTION_PURPOSE}",
        str(doc["purpose"]).strip(),
        "",
        f"## {SECTION_AUDIENCE}",
        str(doc["audience"]).strip(),
        "",
        f"## {SECTION_PREREQUISITES}",
        str(doc["prerequisites"]).strip(),
        "",
        f"## {SECTION_STEPS}",
        "",
    ]

    for index, step in enumerate(doc.get("steps", []), start=1):
        title = str(step.get("title", "")).strip()
        body = str(step.get("body", "")).strip()
        lines.append(f"### {_step_heading(index, title)}")
        lines.append("")
        lines.append(body)
        lines.append("")

        if step.get("needsReview"):
            lines.append("> **Требует проверки:** шаг сформирован с неполными данными.")
            lines.append("")

        image_path = _step_image_path(step, step_image_paths=step_image_paths)
        if image_path:
            lines.append(_markdown_image(title, image_path))
            lines.append("")

    warnings = doc.get("warnings", [])
    if warnings:
        lines.extend([f"## {SECTION_WARNINGS}", ""])
        for warning in warnings:
            lines.append(f"- {str(warning).strip()}")
        lines.append("")

    lines.extend(
        [
            f"## {SECTION_RESULT}",
            str(doc["result"]).strip(),
            "",
        ],
    )

    logger.debug("Rendered markdown for doc with %d steps", len(doc.get("steps", [])))
    return "\n".join(lines)


def render_html(
    doc: dict[str, Any],
    *,
    screenshots_base: str = "screenshots",
    step_image_paths: dict[str, str] | None = None,
    inline_image_data: dict[str, str] | None = None,
) -> str:
    """Собрать самодостаточный HTML, пригодный для печати в PDF."""
    _ = screenshots_base

    steps_html: list[str] = []
    for index, step in enumerate(doc.get("steps", []), start=1):
        title = html.escape(str(step.get("title", "")).strip())
        body = html.escape(str(step.get("body", "")).strip()).replace("\n", "<br>\n")
        review_html = ""
        if step.get("needsReview"):
            review_html = (
                '<p class="needs-review"><strong>Требует проверки:</strong> '
                "шаг сформирован с неполными данными.</p>"
            )

        image_html = ""
        image_path = _step_image_path(
            step,
            step_image_paths=step_image_paths,
            inline_image_data=inline_image_data,
        )
        if image_path:
            image_html = (
                f'<figure class="step-screenshot">'
                f'<img src="{html.escape(image_path, quote=True)}" '
                f'alt="{title}">'
                f"</figure>"
            )

        step_id = html.escape(str(step.get("id", f"step-{index}")), quote=True)
        steps_html.append(
            "\n".join(
                [
                    f'<section class="step" id="{step_id}">',
                    f"<h3>{index}. {title}</h3>",
                    f"<p>{body}</p>",
                    review_html,
                    image_html,
                    "</section>",
                ],
            ),
        )

    warnings = doc.get("warnings", [])
    warnings_html = ""
    if warnings:
        items = "".join(
            f"<li>{html.escape(str(warning).strip())}</li>" for warning in warnings
        )
        warnings_html = (
            f'<section class="warnings"><h2>{SECTION_WARNINGS}</h2><ul>{items}</ul></section>'
        )

    title = html.escape(str(doc["title"]).strip())
    purpose = html.escape(str(doc["purpose"]).strip())
    audience = html.escape(str(doc["audience"]).strip())
    prerequisites = html.escape(str(doc["prerequisites"]).strip())
    result = html.escape(str(doc["result"]).strip())

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }}
    body {{
      margin: 0 auto;
      max-width: 900px;
      padding: 2rem 1.5rem;
      color: #111;
    }}
    h1, h2, h3 {{
      line-height: 1.25;
    }}
    .step {{
      margin: 2rem 0;
      page-break-inside: avoid;
    }}
    .step-screenshot img {{
      display: block;
      max-width: 100%;
      height: auto;
      border: 1px solid #ddd;
      border-radius: 4px;
      margin-top: 0.75rem;
    }}
    .needs-review {{
      color: #8a4b00;
      background: #fff7e8;
      border-left: 4px solid #f0a500;
      padding: 0.5rem 0.75rem;
    }}
    @media print {{
      body {{
        padding: 0;
      }}
      .step-screenshot img {{
        max-height: 85vh;
      }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>{title}</h1>
  </header>
  <section>
    <h2>{SECTION_PURPOSE}</h2>
    <p>{purpose}</p>
  </section>
  <section>
    <h2>{SECTION_AUDIENCE}</h2>
    <p>{audience}</p>
  </section>
  <section>
    <h2>{SECTION_PREREQUISITES}</h2>
    <p>{prerequisites}</p>
  </section>
  <section>
    <h2>{SECTION_STEPS}</h2>
    {"".join(steps_html)}
  </section>
  {warnings_html}
  <section>
    <h2>{SECTION_RESULT}</h2>
    <p>{result}</p>
  </section>
</body>
</html>
"""


def build_markdown_zip(
    doc: dict[str, Any],
    step_images: dict[str, bytes],
    *,
    step_image_paths: dict[str, str] | None = None,
) -> bytes:
    """ZIP с instruction.md и PNG/JPEG скринами по шагам."""
    resolved_paths = dict(step_image_paths or {})
    for step_id in step_images:
        resolved_paths.setdefault(step_id, export_step_image_path(step_id))

    markdown = render_markdown(doc, step_image_paths=resolved_paths)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("instruction.md", markdown)
        written_paths: set[str] = set()
        for step_id, image_bytes in step_images.items():
            path = resolved_paths[step_id]
            if path in written_paths:
                continue
            written_paths.add(path)
            zf.writestr(path, image_bytes)
    return archive.getvalue()
