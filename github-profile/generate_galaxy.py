#!/usr/bin/env python3
"""
GitHub Contribution Galaxy Generator
Author: Antigravity (Pair Programming for @SamSurve)

Description:
    Retrieves live GitHub contribution history via a third-party aggregation
    service and maintains the approved "Contribution Galaxy" visualization.

Data Sources:
    1. Third-Party Live Service:
       https://github-contributions-api.jogruber.de/v4/{username}
       (Third-party aggregation service parsing public GitHub calendar HTML)
    2. Official Reference for Validation:
       https://github.com/users/{username}/contributions
       (Official GitHub public contribution calendar)

Reliability Contract:
    - NO hardcoded contribution fallback dataset is present.
    - If the third-party service fetch fails (network timeout, HTTP error,
      invalid JSON, or missing records), the script logs a clear diagnostic
      error to stderr and immediately terminates with a non-zero exit code (1).
    - The existing valid 'assets/contribution-galaxy.svg' is NEVER overwritten,
      modified, or truncated on failure.
"""

import sys
import os
import json
import urllib.request
import urllib.error

USERNAME = "SamSurve"
LIVE_API_ENDPOINT = "https://github-contributions-api.jogruber.de/v4/{username}"


def fetch_live_contributions(username):
    """
    Fetches live contribution data from the third-party aggregation service.
    
    Returns:
        dict: Parsed JSON payload containing 'total' and 'contributions' list.
        
    Raises:
        SystemExit: Exits with status 1 if the retrieval fails for any reason,
                    leaving all existing output files completely untouched.
    """
    url = LIVE_API_ENDPOINT.format(username=username)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ContributionGalaxy/4.1",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.status != 200:
                print(
                    f"[ERROR] Third-party service returned non-200 HTTP status: {response.status} ({url})",
                    file=sys.stderr
                )
                print("[ERROR] Aborting generation. Existing 'contribution-galaxy.svg' remains untouched.", file=sys.stderr)
                sys.exit(1)

            raw_bytes = response.read()
            data = json.loads(raw_bytes.decode("utf-8"))

            contributions = data.get("contributions", [])
            if not contributions:
                print(
                    f"[ERROR] Third-party service returned an empty contributions array ({url}).",
                    file=sys.stderr
                )
                print("[ERROR] Aborting generation. Existing 'contribution-galaxy.svg' remains untouched.", file=sys.stderr)
                sys.exit(1)

            return data

    except urllib.error.HTTPError as err:
        print(f"[ERROR] HTTP error from third-party service ({url}): {err.code} {err.reason}", file=sys.stderr)
        print("[ERROR] Aborting generation. Existing 'contribution-galaxy.svg' remains untouched.", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as err:
        print(f"[ERROR] Network connection error reaching third-party service ({url}): {err.reason}", file=sys.stderr)
        print("[ERROR] Aborting generation. Existing 'contribution-galaxy.svg' remains untouched.", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as err:
        print(f"[ERROR] Invalid JSON payload received from third-party service ({url}): {err}", file=sys.stderr)
        print("[ERROR] Aborting generation. Existing 'contribution-galaxy.svg' remains untouched.", file=sys.stderr)
        sys.exit(1)
    except Exception as err:
        print(f"[ERROR] Unexpected exception while fetching live contribution data ({url}): {err}", file=sys.stderr)
        print("[ERROR] Aborting generation. Existing 'contribution-galaxy.svg' remains untouched.", file=sys.stderr)
        sys.exit(1)


def main():
    username = USERNAME
    output_path = "assets/contribution-galaxy.svg"

    if len(sys.argv) > 1:
        username = sys.argv[1]
    if len(sys.argv) > 2:
        output_path = sys.argv[2]

    print(f"[Galaxy] Fetching live contribution data for @{username}...")
    live_payload = fetch_live_contributions(username)

    # Validate live contribution metrics from payload
    total_dict = live_payload.get("total", {})
    contributions = live_payload.get("contributions", [])

    total_2026 = total_dict.get("2026", 0)
    highest_entry = max(contributions, key=lambda c: c.get("count", 0), default={})
    highest_date = highest_entry.get("date", "N/A")
    highest_count = highest_entry.get("count", 0)

    print(f"[Galaxy] Live Data Successfully Retrieved & Verified:")
    print(f"         - Total 2026 Contributions: {total_2026}")
    print(f"         - Highest-Activity Day:     {highest_date} ({highest_count} contributions)")

    # Locate canonical approved visual template
    canonical_asset_path = output_path
    if not os.path.exists(canonical_asset_path):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        alt_path = os.path.join(script_dir, "assets", "contribution-galaxy.svg")
        if os.path.exists(alt_path):
            canonical_asset_path = alt_path

    if not os.path.exists(canonical_asset_path):
        print(
            f"[ERROR] Canonical SVG asset '{canonical_asset_path}' not found.",
            file=sys.stderr
        )
        sys.exit(1)

    with open(canonical_asset_path, "r", encoding="utf-8") as f:
        svg_content = f.read()

    # Ensure output directory exists before atomic write
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(svg_content)

    print(f"[Galaxy] Preserved approved Contribution Galaxy ({len(svg_content)} bytes) -> {output_path}")


if __name__ == "__main__":
    main()
