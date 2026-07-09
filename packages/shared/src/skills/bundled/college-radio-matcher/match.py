#!/usr/bin/env python3
"""Validate, filter, and rank a college-radio station directory."""

import argparse
import json
import os
import re
import sys
from urllib.parse import urlparse


RESTRICTIVE_GENRES = {"jazz", "classical", "christian", "news_talk"}
COUNTRY_ALIASES = {
    "us": "USA",
    "usa": "USA",
    "united states": "USA",
    "ca": "Canada",
    "can": "Canada",
    "canada": "Canada",
}


def positive_int(value):
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def comma_set(value, upper=False):
    values = {item.strip() for item in (value or "").split(",") if item.strip()}
    return {item.upper() for item in values} if upper else {item.lower() for item in values}


def region_code(value):
    normalized = value.strip().upper()
    if not re.fullmatch(r"[A-Z]{2}", normalized):
        raise argparse.ArgumentTypeError("must be a two-letter state or province code")
    return normalized


def region_codes(value):
    values = [item.strip() for item in value.split(",") if item.strip()]
    if not values:
        return ""
    return ",".join(region_code(item) for item in values)


def normalize_country(value):
    if not value:
        return ""
    normalized = COUNTRY_ALIASES.get(value.strip().lower())
    if not normalized:
        raise argparse.ArgumentTypeError("must be USA/US or Canada/CA")
    return normalized


def resolve_data_path(value):
    candidate = value or os.environ.get("COLLEGE_RADIO_DIRECTORY")
    if not candidate:
        bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "stations.json")
        if os.path.exists(bundled):
            candidate = bundled
    if not candidate:
        raise ValueError("No station directory found. Pass --data <stations.json> or set COLLEGE_RADIO_DIRECTORY.")
    return os.path.abspath(os.path.expanduser(candidate))


def load_stations(data_path):
    with open(data_path, encoding="utf-8") as handle:
        stations = json.load(handle)
    if not isinstance(stations, list):
        raise ValueError("Station directory must be a JSON array")
    required = {"id", "station", "country", "state", "city"}
    valid = []
    for index, station in enumerate(stations):
        required_invalid = not isinstance(station, dict) or any(
            not isinstance(station.get(key), str) or not station[key].strip()
            for key in required
        )
        placeholder = not required_invalid and station["station"].strip() == "-"
        if required_invalid or placeholder:
            print(f"college-radio-matcher: skipped invalid station record at index {index}", file=sys.stderr)
            continue
        validate_record_types(station, index)
        valid.append(station)
    if not valid:
        raise ValueError(f"No valid station records; required fields: {', '.join(sorted(required))}")
    return dedupe_stations(valid)


def validate_record_types(station, index):
    list_fields = ("emails", "ig_handles", "genre_hints", "submission_methods", "flags", "submission_form_signals")
    for field in list_fields:
        value = station.get(field)
        if value is not None and (not isinstance(value, list) or any(not isinstance(item, str) for item in value)):
            raise ValueError(f"Invalid {field} at station index {index}; expected an array of strings")
    for field in ("website", "submission_url", "music_director", "notes_raw", "outreach_ease", "station_type"):
        value = station.get(field)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"Invalid {field} at station index {index}; expected a string or null")


def canonical_station_key(station):
    station_name = str(station.get("station") or "").upper()
    call_sign = re.sub(r"[^A-Z0-9]", "", station_name.split()[0])
    frequency_raw = str(station.get("frequency") or station_name)
    frequency_match = re.search(r"\b\d{2,3}(?:\.\d+)?\b", frequency_raw)
    frequency = frequency_match.group(0) if frequency_match else ""
    channel_match = re.search(r"\bHD\d+\b", station_name)
    channel = channel_match.group(0) if channel_match else ""
    city = re.sub(r"\s+", " ", str(station.get("city") or "").strip().lower())
    state = str(station.get("state") or "").strip().upper()
    return call_sign, frequency, channel, city, state


def dedupe_stations(stations):
    by_key = {}
    for station in stations:
        key = canonical_station_key(station)
        if key in by_key:
            by_key[key] = merge_duplicate_station(by_key[key], station)
        else:
            by_key[key] = dict(station)
    return list(by_key.values())


def merge_duplicate_station(existing, duplicate):
    merged = dict(existing)
    list_fields = {"emails", "ig_handles", "genre_hints", "submission_methods", "flags", "submission_form_signals"}
    for field in list_fields:
        merged[field] = list(dict.fromkeys([*(existing.get(field) or []), *(duplicate.get(field) or [])]))
    for field in ("website", "phone", "address", "music_director", "school", "show"):
        current = str(merged.get(field) or "").strip()
        candidate = str(duplicate.get(field) or "").strip()
        if current in {"", "-"} and candidate not in {"", "-"}:
            merged[field] = duplicate.get(field)
    notes = [str(value).strip() for value in (existing.get("notes_raw"), duplicate.get("notes_raw")) if str(value or "").strip() not in {"", "-"}]
    if notes:
        merged["notes_raw"] = " | ".join(dict.fromkeys(notes))
    merged_ids = [*(existing.get("_merged_ids") or [existing.get("id")]), duplicate.get("id")]
    merged["_merged_ids"] = list(dict.fromkeys(value for value in merged_ids if value))
    return merged


def clean_url(value):
    raw = str(value or "").strip()
    if not raw or any(character.isspace() for character in raw):
        return None
    parsed = urlparse(raw)
    return raw if parsed.scheme in {"http", "https"} and parsed.netloc else None


def digital_submission_path(station):
    methods = set(station.get("submission_methods") or [])
    notes = str(station.get("notes_raw") or "").lower()
    if "no streaming links" in notes:
        methods.discard("links_preferred")
    if any(valid_email(value) for value in station.get("emails") or []):
        return "email"
    if "form" in methods and (clean_url(station.get("submission_url")) or clean_url(station.get("website"))):
        return "form"
    if clean_url(station.get("submission_url")):
        return "link"
    return None


def valid_email(value):
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", str(value or "")))


def specialist_mismatch(station, genres):
    hints = {str(item).lower() for item in station.get("genre_hints") or []}
    restrictive = hints & RESTRICTIVE_GENRES
    return bool(genres and restrictive and not (hints & genres))


def score(station, args, home_state, market_states, home_city, market_cities, genres):
    points = 0
    reasons = []
    state = str(station.get("state") or "").upper()
    city = str(station.get("city") or "").strip().lower()
    hints = {str(item).lower() for item in station.get("genre_hints") or []}
    methods = set(station.get("submission_methods") or [])

    if home_city and city == home_city and (not home_state or state == home_state):
        points += 10
        reasons.append("hometown city")
    elif home_state and state == home_state:
        points += 4
        reasons.append("home state")
    if city and city in market_cities:
        points += 7
        reasons.append("tour market city")
    elif state in market_states:
        points += 3
        reasons.append("tour market state")
    if genres and hints & genres:
        points += 3
        reasons.append("explicit genre signal")
    if station.get("music_director") not in (None, "", "-"):
        points += 2
        reasons.append("named music director")
    if station.get("outreach_ease") == "easy":
        points += 1
        reasons.append("low-friction submission")
    if args.prefer_links and "links_preferred" in methods:
        points += 1
        reasons.append("links preferred")
    if station.get("outreach_ease") == "hard":
        points -= 2
    if station.get("station_type") == "public_npr":
        points -= 2
    return points, reasons


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", help="Optional path to an updated stations.json")
    parser.add_argument("--home", "--home-state", dest="home_state", type=region_code, help="Hometown state/province code")
    parser.add_argument("--home-city", default="", help="Hometown city for the strongest local boost")
    parser.add_argument("--markets", "--market-states", dest="market_states", type=region_codes, default="", help="Comma-separated tour-market state/province codes")
    parser.add_argument("--market-cities", default="", help="Comma-separated tour-market cities")
    parser.add_argument("--states", type=region_codes, default="", help="Restrict to state/province codes")
    parser.add_argument("--country", type=normalize_country, default="", help="USA/US or Canada/CA")
    parser.add_argument("--genre", default="", help="Comma-separated genre hints")
    parser.add_argument("--require-genre", action="store_true", help="Require an explicit genre-hint match")
    parser.add_argument("--include-unverified-specialists", action="store_true", help="Keep specialist stations whose hints do not match")
    parser.add_argument("--exclude-flags", default="", help="Comma-separated rule flags to drop")
    parser.add_argument("--ease", choices=["easy", "medium", "hard"], default="")
    parser.add_argument("--release", choices=["single", "album"], default="")
    parser.add_argument("--explicit", action="store_true", help="Release contains explicit content")
    parser.add_argument("--clean-edit", action="store_true", help="A clean edit is available")
    parser.add_argument("--links-only", action="store_true", help="Require a usable digital submission path")
    parser.add_argument("--prefer-links", action="store_true")
    parser.add_argument("--limit", type=positive_int, default=50)
    parser.add_argument("--format", choices=["table", "json"], default="table")
    args = parser.parse_args()
    if args.require_genre and not args.genre.strip():
        parser.error("--require-genre needs --genre")
    if args.clean_edit and not args.explicit:
        parser.error("--clean-edit only applies with --explicit")
    return args


def main():
    args = parse_args()
    try:
        stations = load_stations(resolve_data_path(args.data))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"college-radio-matcher: {error}", file=sys.stderr)
        return 2

    home_state = (args.home_state or "").strip().upper()
    home_city = (args.home_city or "").strip().lower()
    market_states = comma_set(args.market_states, upper=True)
    market_cities = comma_set(args.market_cities)
    states = comma_set(args.states, upper=True)
    genres = comma_set(args.genre)
    excluded_flags = comma_set(args.exclude_flags)

    output = []
    for station in stations:
        state = str(station.get("state") or "").upper()
        flags = set(station.get("flags") or [])
        hints = {str(item).lower() for item in station.get("genre_hints") or []}
        if states and state not in states:
            continue
        if args.country and station.get("country") != args.country:
            continue
        if args.ease and station.get("outreach_ease") != args.ease:
            continue
        if excluded_flags & flags:
            continue
        if args.release == "single" and "albums_only" in flags:
            continue
        if args.explicit and not args.clean_edit and "positive_content_only" in flags:
            continue
        submission_path = digital_submission_path(station)
        if args.links_only and not submission_path:
            continue
        if args.require_genre and not (hints & genres):
            continue
        if not args.include_unverified_specialists and specialist_mismatch(station, genres):
            continue

        points, reasons = score(station, args, home_state, market_states, home_city, market_cities, genres)
        item = dict(station)
        item["_score"] = points
        item["_match"] = {
            "rationale": reasons or ["directory candidate; live fit verification required"],
            "submissionPath": submission_path or "unknown",
            "rules": sorted(flags),
            "evidenceUrl": clean_url(station.get("website")),
            "verificationStatus": "directory_only",
            "verifiedAt": None,
            "directoryWarnings": ([f"merged duplicate records: {', '.join(item['_merged_ids'])}"] if item.get("_merged_ids") else []),
        }
        item.pop("_merged_ids", None)
        output.append(item)

    output.sort(key=lambda item: (-item["_score"], str(item.get("state") or ""), str(item.get("city") or ""), str(item.get("station") or "")))
    output = output[: args.limit]

    if args.format == "json":
        print(json.dumps(output, indent=2))
        return 0
    print(f"{'#':>2}  {'score':>5}  {'station':16} {'city, ST':22} {'path':8} {'verification'}")
    print("-" * 84)
    for index, station in enumerate(output, 1):
        location = f"{station.get('city', '')}, {station.get('state', '')}"
        match = station["_match"]
        print(f"{index:>2}  {station['_score']:>5}  {station['station']:16.16} {location:22.22} {match['submissionPath']:8} directory only")
    print(f"\n{len(output)} candidates. Verify current fit, contact, and rules before outreach.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
