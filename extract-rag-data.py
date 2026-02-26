#!/usr/bin/env python3
"""Extract RAG status data from all HTML reports into rag-history.json."""

import json
import os
import re
import glob
from html.parser import HTMLParser


class RAGExtractor(HTMLParser):
    """Parse a single report HTML and extract country RAG data."""

    def __init__(self):
        super().__init__()
        self.countries = {}
        self.report_date = None
        self.report_title = None

        # Parser state
        self._in_country_card = False
        self._current_country = None
        self._in_country_name = False
        self._in_rag_badges = False
        self._current_badge_class = None
        self._in_badge_label = False
        self._badge_label_text = ""
        self._in_report_date = False
        self._in_report_title = False

        # Health matrix parsing
        self._in_health_matrix = False
        self._in_health_row = False
        self._health_cells = []
        self._in_td = False
        self._td_text = ""
        self._current_rag_dot = None

        # Movement table parsing
        self._in_movement_table = False
        self._in_movement_row = False
        self._movement_cells = []
        self._movement_dots = []

        # RAG summary
        self._in_rag_summary = False
        self._in_rag_summary_item = False
        self._rag_summary_class = None
        self._in_rag_count = False
        self._in_rag_countries = False
        self._rag_count_text = ""
        self._rag_countries_text = ""
        self._rag_summary = {}

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        classes = attrs_dict.get("class", "")

        # Report title
        if "report-title" in classes:
            self._in_report_title = True

        # Report date
        if "report-date" in classes:
            self._in_report_date = True

        # RAG Summary bar
        if "rag-summary" in classes and "rag-summary-item" not in classes and "rag-summary-heading" not in classes and "rag-summary-count" not in classes and "rag-summary-label" not in classes and "rag-summary-countries" not in classes:
            self._in_rag_summary = True
        if "rag-summary-item" in classes:
            self._in_rag_summary_item = True
            for c in classes.split():
                if c in ("red", "amber", "green", "no-data"):
                    self._rag_summary_class = c
        if "rag-summary-count" in classes:
            self._in_rag_count = True
            self._rag_count_text = ""
        if "rag-summary-countries" in classes:
            self._in_rag_countries = True
            self._rag_countries_text = ""

        # Country card
        if "country-card" in classes:
            self._in_country_card = True
            self._current_country = None
            # Extract overall RAG from card class
            for c in classes.split():
                if c.startswith("rag-"):
                    rag = c[4:]  # remove "rag-" prefix
                    self._card_rag = rag

        # Country name
        if "country-name" in classes:
            self._in_country_name = True

        # RAG badges container
        if "rag-badges" in classes:
            self._in_rag_badges = True

        # Individual RAG badge
        if "rag-badge" in classes and self._in_rag_badges:
            badge_rag = None
            for c in classes.split():
                if c in ("red", "amber", "green", "blocked", "no-data"):
                    badge_rag = c
                    break
            self._current_badge_class = badge_rag

        # Badge label span
        if tag == "span" and "label" in classes and self._in_rag_badges:
            self._in_badge_label = True
            self._badge_label_text = ""

        # Health matrix table
        if "health-matrix" in classes:
            self._in_health_matrix = True

        if self._in_health_matrix and tag == "tr":
            self._in_health_row = True
            self._health_cells = []

        if self._in_health_matrix and tag == "td":
            self._in_td = True
            self._td_text = ""
            self._current_rag_dot = None

        # RAG dot in health matrix
        if "rag-dot" in classes:
            for c in classes.split():
                if c in ("red", "amber", "green", "blocked", "none"):
                    self._current_rag_dot = c if c != "none" else "no-data"

        # Movement table
        if "movement-table" in classes:
            self._in_movement_table = True

        if self._in_movement_table and tag == "tr":
            self._in_movement_row = True
            self._movement_cells = []
            self._movement_dots = []

        if self._in_movement_table and tag == "td":
            self._in_td = True
            self._td_text = ""

    def handle_endtag(self, tag):
        if tag == "div" and self._in_report_title:
            self._in_report_title = False
        if tag == "div" and self._in_report_date:
            self._in_report_date = False

        if tag == "div" and self._in_rag_count:
            self._in_rag_count = False
            if self._rag_summary_class:
                self._rag_summary.setdefault(self._rag_summary_class, {})["count"] = self._rag_count_text.strip()
        if tag == "div" and self._in_rag_countries:
            self._in_rag_countries = False
            if self._rag_summary_class:
                self._rag_summary.setdefault(self._rag_summary_class, {})["countries"] = self._rag_countries_text.strip()
        if tag == "div" and self._in_rag_summary_item:
            self._in_rag_summary_item = False
            self._rag_summary_class = None

        if tag == "span" and self._in_badge_label:
            self._in_badge_label = False

        if tag == "span" and self._current_badge_class and self._in_rag_badges and not self._in_badge_label:
            # This badge is done - record it
            if self._current_country:
                label = self._badge_label_text.strip().lower() if self._badge_label_text.strip() else "overall"
                if self._current_country not in self.countries:
                    self.countries[self._current_country] = {}
                self.countries[self._current_country][label] = self._current_badge_class
            self._current_badge_class = None
            self._badge_label_text = ""

        if tag == "div" and self._in_rag_badges:
            self._in_rag_badges = False

        if tag == "div" and self._in_country_name:
            self._in_country_name = False

        if tag == "div" and self._in_country_card:
            # Don't close on inner divs - only close on the card's own closing
            pass

        # Health matrix
        if self._in_health_matrix and tag == "td":
            self._in_td = False
            if self._current_rag_dot:
                self._health_cells.append(("dot", self._current_rag_dot))
            else:
                self._health_cells.append(("text", self._td_text.strip()))
            self._current_rag_dot = None

        if self._in_health_matrix and tag == "tr" and self._in_health_row:
            self._in_health_row = False
            if self._health_cells:
                self._process_health_row(self._health_cells)

        if self._in_health_matrix and tag == "table":
            self._in_health_matrix = False

        # Movement table
        if self._in_movement_table and tag == "td":
            self._in_td = False
            if self._current_rag_dot:
                self._movement_cells.append(("dot", self._current_rag_dot))
            else:
                self._movement_cells.append(("text", self._td_text.strip()))
            self._current_rag_dot = None

        if self._in_movement_table and tag == "tr" and self._in_movement_row:
            self._in_movement_row = False
            if len(self._movement_cells) >= 4:
                self._process_movement_row(self._movement_cells)
            self._movement_cells = []

        if self._in_movement_table and tag == "table":
            self._in_movement_table = False

    def handle_data(self, data):
        if self._in_report_title:
            self.report_title = data.strip()

        if self._in_report_date:
            self.report_date = data.strip()

        if self._in_rag_count:
            self._rag_count_text += data
        if self._in_rag_countries:
            self._rag_countries_text += data

        if self._in_country_name and not self._in_badge_label:
            text = data.strip()
            # Filter out flag emojis and annotations, get country name
            if text and not text.startswith("\u2014") and len(text) > 1:
                # Clean up the name
                name = text.strip()
                if name and name not in ("", " "):
                    # Handle names like "UAE (Corner 4)" -> "UAE"
                    self._current_country = name

        if self._in_badge_label:
            self._badge_label_text += data

        if self._in_rag_badges and self._current_badge_class and not self._in_badge_label:
            text = data.strip()
            if text and text.lower() == "overall":
                # This is the overall badge text (no label span)
                pass

        if self._in_td:
            self._td_text += data

    def handle_entityref(self, name):
        if self._in_report_date:
            if name == "middot":
                self.report_date = (self.report_date or "") + " "
        if self._in_country_name:
            pass  # skip entities in country names
        if self._in_rag_countries:
            if name == "mdash":
                self._rag_countries_text += "-"

    def _process_health_row(self, cells):
        """Process a row from the health matrix table."""
        if len(cells) < 3:
            return
        # First cell is country name (text), second is category (text), rest are RAG dots
        country = None
        category = None
        dimensions = []
        for i, (ctype, val) in enumerate(cells):
            if i == 0 and ctype == "text":
                country = val
            elif i == 1 and ctype == "text":
                category = val
            elif ctype == "dot":
                dimensions.append(val)

        if country and dimensions:
            dim_names = ["compliance", "product", "engineering", "delivery", "overall"]
            if country not in self.countries:
                self.countries[country] = {}
            for j, dim_val in enumerate(dimensions):
                if j < len(dim_names):
                    self.countries[country][dim_names[j]] = dim_val if dim_val != "no-data" else "no-data"

    def _process_movement_row(self, cells):
        """Process a row from the movement table for previous RAG."""
        # cells: [("text", country), ("dot", prev_rag), ("dot", curr_rag), ("text", change)]
        pass  # Movement data handled by comparing reports

    def get_results(self):
        return {
            "countries": self.countries,
            "rag_summary": self._rag_summary,
            "report_date": self.report_date,
            "report_title": self.report_title,
        }


def extract_date_from_filename(filename):
    """Extract date from report filename like 2026-02-15.html."""
    base = os.path.basename(filename).replace(".html", "")
    return base


VALID_COUNTRIES = {
    "India", "Malaysia", "KSA", "Belgium", "Croatia", "Poland",
    "UAE", "Germany", "France", "Singapore", "Jordan", "Egypt",
    "Qatar", "Oman", "Philippines",
}


def normalize_country_name(name):
    """Normalize country name for consistent keys."""
    name = name.strip()
    # Filter out non-country strings
    if name.startswith("\u2192") or name.startswith("→") or len(name) > 40:
        return None
    # Remove parenthetical suffixes like "(Corner 4)"
    name = re.sub(r"\s*\(.*?\)\s*$", "", name)
    # Only keep known countries
    if name not in VALID_COUNTRIES:
        return None
    return name


def extract_report(filepath):
    """Extract RAG data from a single report HTML file."""
    with open(filepath, "r", encoding="utf-8") as f:
        html = f.read()

    parser = RAGExtractor()
    parser.feed(html)
    results = parser.get_results()

    # Normalize country names
    normalized = {}
    for country, data in results["countries"].items():
        key = normalize_country_name(country)
        if key:
            normalized[key] = data

    results["countries"] = normalized
    return results


def main():
    reports_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rag-history.json")

    # Find all report HTML files (exclude styles.css)
    report_files = sorted(glob.glob(os.path.join(reports_dir, "*.html")))

    if not report_files:
        print("No report files found in", reports_dir)
        return

    # Deduplicate: for dates with multiple versions (e.g., 2026-02-17-2, -3, etc.)
    # keep the highest version number as the latest
    date_files = {}
    for f in report_files:
        base = os.path.basename(f).replace(".html", "")
        # Extract base date (YYYY-MM-DD)
        date_match = re.match(r"(\d{4}-\d{2}-\d{2})", base)
        if date_match:
            date_key = date_match.group(1)
            # Keep the last one (highest version) for each date
            date_files[date_key] = f

    # Sort by date
    sorted_dates = sorted(date_files.keys())

    all_countries = set()
    history = {}

    for date in sorted_dates:
        filepath = date_files[date]
        print(f"Extracting: {os.path.basename(filepath)} -> {date}")
        try:
            results = extract_report(filepath)
            for country, data in results["countries"].items():
                all_countries.add(country)
                if country not in history:
                    history[country] = []
                entry = {"date": date}
                entry.update(data)
                history[country].append(entry)
        except Exception as e:
            print(f"  ERROR: {e}")

    # Build output structure
    output = {
        "reports": sorted_dates,
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "countries": {}
    }

    for country in sorted(all_countries):
        output["countries"][country] = {
            "history": history.get(country, [])
        }

    # Write output
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {output_path}")
    print(f"Reports: {len(sorted_dates)}")
    print(f"Countries: {len(all_countries)}")
    for country in sorted(all_countries):
        entries = len(history.get(country, []))
        print(f"  {country}: {entries} data points")


if __name__ == "__main__":
    main()
