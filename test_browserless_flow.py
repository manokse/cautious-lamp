#!/usr/bin/env python3
"""Diagnostic runner for Browserless account generation flow.

Usage examples:
  python test_browserless_flow.py worker --url https://example.workers.dev/api/generate
  python test_browserless_flow.py direct --max-wait 120 --log-file debug_run.json
"""

from __future__ import annotations

import argparse
import json
import random
import re
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
    "ImNjZGVpZ3p3ZHRzZHVienRja3dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI5MzE1NDYs"
    "ImV4cCI6MjA1ODUwNzU0Nn0.QixgX2_e_T1cfKXKsxVNMx9isiE3Y-DBkU5NPziyZek"
)

DEFAULT_DOMAINS = ["ji-a.cc", "waroengin.com", "sumberakun.com", "bosakun.com", "otpku.com"]

SIGNUP_MUTATION_PRIMARY = """
mutation signup($user: signUpSession, $completedActionId: String, $promoCode: String, $referralCode: String, $frontendUrl: String) {
  signupCloudUnits(
    user: $user
    completedActionId: $completedActionId
    promoCode: $promoCode
    referralCode: $referralCode
    frontendUrl: $frontendUrl
  ) {
    authToken
    paymentLink
    __typename
  }
}
""".strip()

SIGNUP_MUTATION_FALLBACK = """
mutation signup($user: SignupInput!, $frontendUrl: String!) {
  signup(user: $user, frontendUrl: $frontendUrl) {
    id
    email
    plan
    __typename
  }
}
""".strip()

CHANGE_TOKEN_MUTATION = """
mutation changeToken($token: String!, $authToken: String) {
    changeToken(token: $token, authToken: $authToken) {
    token
    __typename
  }
}
""".strip()

GET_ACCOUNT_QUERY = """
query getAccount($authToken: String) {
    account(authToken: $authToken) {
    email
    ownerEmail
    apiKey
    plan
    maxConcurrent
    maxQueued
    __typename
  }
}
""".strip()


@dataclass
class HttpResult:
    status: int
    headers: dict[str, str]
    text: str
    json_data: Any


class RequestClient:
    def __init__(self, timeout: int = 40):
        self.timeout = timeout

    def request(
        self,
        url: str,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
    ) -> HttpResult:
        req = urllib.request.Request(url=url, method=method, headers=headers or {}, data=data)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read()
                status = response.getcode()
                response_headers = {k.lower(): v for k, v in response.headers.items()}
        except urllib.error.HTTPError as error:
            raw = error.read()
            status = error.code
            response_headers = {k.lower(): v for k, v in error.headers.items()}

        text = raw.decode("utf-8", errors="replace")
        try:
            parsed_json = json.loads(text) if text else {}
        except json.JSONDecodeError:
            parsed_json = None

        return HttpResult(
            status=status,
            headers=response_headers,
            text=text,
            json_data=parsed_json,
        )


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def rand_string(size: int = 10) -> str:
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choice(chars) for _ in range(size))


def rand_token(size: int = 48) -> str:
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choice(chars) for _ in range(size))


def parse_domains(path: Path) -> list[str]:
    if not path.exists():
        return DEFAULT_DOMAINS

    out: list[str] = []
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "." not in line:
            continue

        if ". " in line:
            candidate = line.split(". ", 1)[1].strip()
            if "." in candidate:
                out.append(candidate)
            continue

        out.append(line)

    return list(dict.fromkeys(out)) or DEFAULT_DOMAINS


def extract_inbox_meta(html: str) -> dict[str, str]:
    def pick(pattern: str) -> str:
        match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            return ""
        return re.sub(r"<[^>]+>", " ", match.group(1)).strip()

    return {
        "to": pick(r"To:\s*</span>\s*<span>([^<]+)"),
        "from": pick(r"From:\s*</span>\s*<span>([^<]+)"),
        "subject": pick(r"Subject:[\s\S]{0,280}?<h1[^>]*>([\s\S]*?)</h1>"),
        "received": pick(r"Received:\s*</span>\s*<span>([^<]+)"),
    }


def extract_otp_candidates(html: str) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []

    def push(code: str, reason: str) -> None:
        normalized = re.sub(r"\D", "", code)
        if len(normalized) != 6:
            return
        if any(item["code"] == normalized for item in candidates):
            return
        candidates.append({"code": normalized, "reason": reason})

    patterns = [
        (r"Please copy or use the code below[\s\S]{0,1400}?\b(\d{6})\b", "copy_code_block"),
        (r"\[Action required\]\s*Verify your email address[\s\S]{0,2800}?\b(\d{6})\b", "action_required"),
        (r"font-family:\s*monospace[\s\S]{0,260}>\s*(\d{6})\s*</div>", "monospace_code"),
        (r"Verify your email[\s\S]{0,2400}?\b(\d{6})\b", "verify_block"),
    ]

    for pattern, reason in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if match:
            push(match.group(1), reason)

    section = re.search(r"Verify your email[\s\S]{0,3200}", html, flags=re.IGNORECASE)
    if section:
        for item in re.findall(r"\b(\d{6})\b", section.group(0)):
            push(item, "verify_section_scan")

    return candidates


def score_candidate(candidate: dict[str, Any]) -> int:
    meta = candidate.get("meta", {})
    subject = str(meta.get("subject", "")).lower()
    sender = str(meta.get("from", "")).lower()
    reason = str(candidate.get("reason", ""))

    score = 0
    if "browserless.io" in sender:
        score += 6
    if "verify your email" in subject:
        score += 6
    if "action required" in subject:
        score += 2
    if reason == "copy_code_block":
        score += 5
    if reason == "monospace_code":
        score += 4
    if reason == "action_required":
        score += 3

    return score


def summarize_http(result: HttpResult) -> str:
    text = result.text.strip().replace("\n", " ")
    return f"status={result.status} body={text[:220]}"


def ensure_status(result: HttpResult, expected: int, label: str) -> None:
    if result.status != expected:
        raise RuntimeError(f"{label} failed ({summarize_http(result)})")


def worker_test(args: argparse.Namespace) -> int:
    client = RequestClient(timeout=args.timeout)
    payload = {
        "maxOtpWaitSeconds": args.max_wait,
        "proxyEnabled": False,
        "proxyUrl": "",
        "preferredToken": rand_token(48),
        "profile": {
            "fullName": f"Diag {rand_string(6)}",
            "company": "Diagnostic Labs",
            "plan": "free",
            "useCase": "scraping",
            "projectType": "newProject",
            "attribution": "searchEngine",
            "frontendUrl": "https://www.browserless.io/signup/payment-completed",
            "line1": "",
            "line2": "",
            "postalCode": "",
            "city": "",
            "state": "",
            "country": "",
            "taxId": "",
        },
    }

    print(f"[{now_iso()}] Worker test -> {args.url}")
    health = client.request(args.url, method="GET")
    print(f"health: {summarize_http(health)}")

    result = client.request(
        args.url,
        method="POST",
        headers={"content-type": "application/json"},
        data=json.dumps(payload).encode("utf-8"),
    )
    print(f"post: {summarize_http(result)}")

    output = {
        "timestamp": now_iso(),
        "url": args.url,
        "health": asdict(health),
        "post": asdict(result),
    }

    if args.log_file:
        Path(args.log_file).write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"saved log: {args.log_file}")

    return 0


def direct_test(args: argparse.Namespace) -> int:
    client = RequestClient(timeout=args.timeout)
    anon_key = args.anon_key or DEFAULT_SUPABASE_ANON_KEY
    domains = parse_domains(Path(args.domain_file))

    user = rand_string(10)
    domain = random.choice(domains)
    email = f"{user}@{domain}"

    print(f"[{now_iso()}] mailbox: {email}")

    cookie = f"surl={urllib.parse.quote(domain + '/' + user)}; embx={urllib.parse.quote(json.dumps([email]))}"

    setup_form = urllib.parse.urlencode({"usr": user, "dmn": domain}).encode("utf-8")
    setup = client.request(
        "https://emailfake.com/check_adres_validation3.php",
        method="POST",
        headers={
            "accept": "application/json, text/javascript, */*; q=0.01",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest",
            "origin": "https://emailfake.com",
            "referer": f"https://emailfake.com/{domain}/{user}",
            "cookie": cookie,
        },
        data=setup_form,
    )
    ensure_status(setup, 200, "emailfake setup")
    print(f"setup: {summarize_http(setup)}")

    otp_payload = {
        "email": email,
        "data": {},
        "create_user": True,
        "gotrue_meta_security": {},
        "code_challenge": None,
        "code_challenge_method": None,
    }
    otp_req = client.request(
        "https://data.browserless.io/auth/v1/otp",
        method="POST",
        headers={
            "accept": "*/*",
            "content-type": "application/json;charset=UTF-8",
            "apikey": anon_key,
            "authorization": f"Bearer {anon_key}",
            "origin": "https://www.browserless.io",
            "referer": "https://www.browserless.io/",
            "x-client-info": "supabase-js-web/2.100.0",
            "x-supabase-api-version": "2024-01-01",
            "accept-encoding": "identity",
        },
        data=json.dumps(otp_payload).encode("utf-8"),
    )
    ensure_status(otp_req, 200, "request OTP")
    print(f"otp request: {summarize_http(otp_req)}")

    candidates: list[dict[str, Any]] = []
    attempts = max(1, int(args.max_wait / 5))

    for attempt in range(1, attempts + 1):
        for channel_id in range(1, 9):
            inbox = client.request(
                f"https://emailfake.com/channel{channel_id}/",
                method="GET",
                headers={
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "referer": "https://emailfake.com/",
                    "cookie": cookie,
                    "accept-encoding": "identity",
                },
            )
            if inbox.status != 200:
                continue

            meta = extract_inbox_meta(inbox.text)
            found = extract_otp_candidates(inbox.text)
            for item in found:
                entry = {
                    "code": item["code"],
                    "reason": item["reason"],
                    "channel": channel_id,
                    "meta": meta,
                }
                if not any(c["code"] == entry["code"] for c in candidates):
                    candidates.append(entry)

        if candidates:
            break

        print(f"poll attempt {attempt}/{attempts}: no OTP, waiting 5s")
        time.sleep(5)

    if not candidates:
        raise RuntimeError("No OTP candidate found from emailfake")

    candidates.sort(key=score_candidate, reverse=True)
    print("otp candidates:", [{"code": c["code"], "channel": c["channel"], "reason": c["reason"]} for c in candidates])

    verify_data = None
    verified_code = None

    for candidate in candidates:
        verify_payload = {
            "email": email,
            "token": candidate["code"],
            "type": "email",
            "gotrue_meta_security": {},
        }

        verify = client.request(
            "https://data.browserless.io/auth/v1/verify",
            method="POST",
            headers={
                "accept": "*/*",
                "content-type": "application/json;charset=UTF-8",
                "apikey": anon_key,
                "authorization": f"Bearer {anon_key}",
                "origin": "https://www.browserless.io",
                "referer": "https://www.browserless.io/",
                "x-client-info": "supabase-js-web/2.100.0",
                "x-supabase-api-version": "2024-01-01",
                "accept-encoding": "identity",
            },
            data=json.dumps(verify_payload).encode("utf-8"),
        )

        print(f"verify {candidate['code']}: {summarize_http(verify)}")
        if verify.status == 200 and isinstance(verify.json_data, dict):
            verify_data = verify.json_data
            verified_code = candidate["code"]
            break

    if not verify_data:
        raise RuntimeError("OTP verify failed for all candidates")

    access_token = (
        verify_data.get("access_token")
        or (verify_data.get("session") or {}).get("access_token")
        or ""
    )
    refresh_token = (
        verify_data.get("refresh_token")
        or (verify_data.get("session") or {}).get("refresh_token")
        or ""
    )

    if refresh_token:
        refresh = client.request(
            "https://data.browserless.io/auth/v1/token?grant_type=refresh_token",
            method="POST",
            headers={
                "accept": "*/*",
                "content-type": "application/json;charset=UTF-8",
                "apikey": anon_key,
                "authorization": f"Bearer {anon_key}",
                "origin": "https://www.browserless.io",
                "referer": "https://www.browserless.io/",
                "x-client-info": "supabase-js-web/2.100.0",
                "x-supabase-api-version": "2024-01-01",
                "accept-encoding": "identity",
            },
            data=json.dumps({"refresh_token": refresh_token}).encode("utf-8"),
        )
        print(f"refresh: {summarize_http(refresh)}")
        if refresh.status == 200 and isinstance(refresh.json_data, dict):
            access_token = (
                refresh.json_data.get("access_token")
                or (refresh.json_data.get("session") or {}).get("access_token")
                or access_token
            )

    if not access_token:
        raise RuntimeError("No access token after verify/refresh")

    profile = {
        "fullName": f"Diag {rand_string(6)}",
        "company": "Diagnostic Labs",
        "attribution": "searchEngine",
        "email": email,
        "oauthUserId": verify_data.get("user", {}).get("id") or rand_string(16),
        "plan": "free",
        "projectType": "newProject",
        "useCases": ["scraping"],
        "address": {
            "line1": "",
            "line2": "",
            "postalCode": "",
            "country": "",
            "state": "",
            "city": "",
            "taxId": "",
        },
    }

    graphql_headers = {
        "accept": "*/*",
        "content-type": "application/json",
        "origin": "https://www.browserless.io",
        "referer": "https://www.browserless.io/",
        "authorization": f"Bearer {access_token}",
        "accept-encoding": "identity",
    }

    get_account_pre = client.request(
        "https://api.browserless.io/graphql",
        method="POST",
        headers=graphql_headers,
        data=json.dumps(
            {
                "operationName": "getAccount",
                "query": GET_ACCOUNT_QUERY,
                "variables": {},
            }
        ).encode("utf-8"),
    )
    print(f"getAccount(pre): {summarize_http(get_account_pre)}")

    signup_primary = client.request(
        "https://api.browserless.io/graphql",
        method="POST",
        headers=graphql_headers,
        data=json.dumps(
            {
                "operationName": "signup",
                "query": SIGNUP_MUTATION_PRIMARY,
                "variables": {
                    "user": profile,
                    "frontendUrl": "https://www.browserless.io/signup/payment-completed",
                },
            }
        ).encode("utf-8"),
    )
    print(f"signup(primary): {summarize_http(signup_primary)}")

    signup_auth_token = ""
    if isinstance(signup_primary.json_data, dict):
        signup_auth_token = (
            ((signup_primary.json_data.get("data") or {}).get("signupCloudUnits") or {}).get("authToken")
            or ""
        )

    signup_fallback = client.request(
        "https://api.browserless.io/graphql",
        method="POST",
        headers=graphql_headers,
        data=json.dumps(
            {
                "operationName": "signup",
                "query": SIGNUP_MUTATION_FALLBACK,
                "variables": {
                    "user": profile,
                    "frontendUrl": "https://www.browserless.io/signup/payment-completed",
                },
            }
        ).encode("utf-8"),
    )
    print(f"signup(fallback): {summarize_http(signup_fallback)}")

    desired_token = rand_token(48)
    change_token = client.request(
        "https://api.browserless.io/graphql",
        method="POST",
        headers=graphql_headers,
        data=json.dumps(
            {
                "operationName": "changeToken",
                "query": CHANGE_TOKEN_MUTATION,
                "variables": {"token": desired_token, "authToken": signup_auth_token or None},
            }
        ).encode("utf-8"),
    )
    print(f"changeToken: {summarize_http(change_token)}")

    get_account_post = client.request(
        "https://api.browserless.io/graphql",
        method="POST",
        headers=graphql_headers,
        data=json.dumps(
            {
                "operationName": "getAccount",
                "query": GET_ACCOUNT_QUERY,
                "variables": {"authToken": signup_auth_token or None},
            }
        ).encode("utf-8"),
    )
    print(f"getAccount(post): {summarize_http(get_account_post)}")

    output = {
        "timestamp": now_iso(),
        "email": email,
        "verified_code": verified_code,
        "otp_candidates": candidates,
        "verify": verify_data,
        "graphql": {
            "get_account_pre": asdict(get_account_pre),
            "signup_primary": asdict(signup_primary),
            "signup_fallback": asdict(signup_fallback),
            "change_token": asdict(change_token),
            "get_account_post": asdict(get_account_post),
        },
    }

    if args.log_file:
        Path(args.log_file).write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"saved log: {args.log_file}")

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Browserless diagnostic runner")
    parser.add_argument("--timeout", type=int, default=45, help="HTTP timeout in seconds")
    parser.add_argument("--max-wait", type=int, default=90, help="Max wait for OTP in seconds")
    parser.add_argument("--log-file", type=str, default="", help="Write JSON diagnostic output")

    subparsers = parser.add_subparsers(dest="mode", required=True)

    worker = subparsers.add_parser("worker", help="Test deployed /api/generate endpoint")
    worker.add_argument("--url", required=True, help="Full URL to /api/generate")

    direct = subparsers.add_parser("direct", help="Run direct end-to-end diagnostic against providers")
    direct.add_argument("--anon-key", default="", help="Override Browserless supabase anon key")
    direct.add_argument("--domain-file", default="domain.txt", help="Path to domain list file")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    random.seed()

    try:
        if args.mode == "worker":
            return worker_test(args)
        if args.mode == "direct":
            return direct_test(args)

        raise RuntimeError("Unknown mode")
    except Exception as error:  # noqa: BLE001
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
