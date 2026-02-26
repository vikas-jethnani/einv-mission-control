#!/usr/bin/env python3
"""Generate AI insights from RAG history data using Claude API.

Usage:
    python3 generate-insights.py                    # Generate for latest report
    python3 generate-insights.py 2026-02-26         # Generate for specific date
    python3 generate-insights.py --all              # Generate for all reports

Requires ANTHROPIC_API_KEY environment variable.
"""

import json
import os
import sys

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic package not installed. Run: pip install anthropic")
    sys.exit(1)


def load_rag_history():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rag-history.json")
    with open(path, "r") as f:
        return json.load(f)


def generate_insights(rag_history, target_date):
    """Call Claude API to generate insights for a specific report date."""
    client = anthropic.Anthropic()

    # Build context about the target date
    reports = rag_history["reports"]
    countries = rag_history["countries"]

    # Get RAG data for the target date and historical context
    context_lines = []
    context_lines.append(f"Report Date: {target_date}")
    context_lines.append(f"Total Reports Available: {len(reports)}")
    context_lines.append(f"Report Dates: {', '.join(reports)}")
    context_lines.append("")

    for country_name, country_data in sorted(countries.items()):
        history = country_data.get("history", [])
        if not history:
            continue

        context_lines.append(f"## {country_name}")
        for entry in history:
            date = entry["date"]
            overall = entry.get("overall", "no-data")
            dims = []
            for dim in ["compliance", "engineering", "product", "delivery"]:
                if dim in entry:
                    dims.append(f"{dim}={entry[dim]}")
            dim_str = ", ".join(dims) if dims else "no dimension data"
            marker = " <-- TARGET" if date == target_date else ""
            context_lines.append(f"  {date}: Overall={overall} ({dim_str}){marker}")
        context_lines.append("")

    context = "\n".join(context_lines)

    prompt = f"""You are an AI leadership analyst for a global e-invoicing program tracking 10+ countries.

Given the following RAG (Red/Amber/Green) status history across multiple reports, generate an analysis for the report dated {target_date}.

RAG History Data:
{context}

Generate a JSON response with this exact structure:
{{
  "date": "{target_date}",
  "executive_summary": "2-3 sentence high-level summary of the program state",
  "trends": [
    {{"country": "Name", "insight": "Specific observation about this country's trajectory", "severity": "positive|warning|negative|neutral"}}
  ],
  "predictions": [
    {{"country": "Name", "prediction": "Forward-looking prediction with conditions", "confidence": "high|medium|low"}}
  ],
  "coaching": [
    "Actionable coaching insight for leadership..."
  ],
  "risk_watch": [
    "Specific risk to monitor with recommended action..."
  ]
}

Guidelines:
- Be specific and evidence-based. Reference actual RAG changes and patterns.
- Predictions should include conditions ("if X happens, then Y").
- Coaching should be actionable — tell leadership what to DO.
- Risk watch should include recommended timelines for action.
- Focus on the 10 main countries (India, Malaysia, KSA, Belgium, Croatia, Poland, UAE, Germany, France, Singapore).
- Skip pipeline-only countries (Jordan, Egypt, etc.) unless they have significant data.

Return ONLY valid JSON, no markdown formatting."""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    # Parse the JSON response
    response_text = response.content[0].text.strip()
    # Handle potential markdown code blocks
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

    return json.loads(response_text)


def save_insights(insights, date):
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "insights")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{date}.json")

    with open(output_path, "w") as f:
        json.dump(insights, f, indent=2, ensure_ascii=False)

    print(f"Saved insights to {output_path}")


def main():
    rag_history = load_rag_history()
    reports = rag_history["reports"]

    if len(sys.argv) > 1:
        if sys.argv[1] == "--all":
            dates = reports
        else:
            dates = [sys.argv[1]]
    else:
        dates = [reports[-1]]  # Latest report

    for date in dates:
        if date not in reports:
            print(f"WARNING: {date} not found in reports. Skipping.")
            continue

        print(f"Generating insights for {date}...")
        try:
            insights = generate_insights(rag_history, date)
            save_insights(insights, date)
        except Exception as e:
            print(f"  ERROR: {e}")


if __name__ == "__main__":
    main()
