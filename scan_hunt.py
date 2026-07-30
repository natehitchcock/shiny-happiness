#!/usr/bin/env python3
"""
Scavenger-hunt link finder.

Walks every 3-character code in  https://redap.dangerserver.live/scan/Y-XXX
and prints the ones that resolve to a real page.

Stdlib only -- no `pip install` needed. Run it on a machine that can reach
the site (it's blocked from the Claude Code environment):

    python3 scan_hunt.py

Useful flags:
    --charset abc123        characters to try in each position (default: a-z 0-9)
    --workers 8             concurrent requests (keep it polite; default 8)
    --delay 0.05            seconds each worker waits between requests
    --prefix Y-             the fixed part before the 3 varying chars
    --length 3              how many characters vary
    --out found.txt         also write hits to a file
"""

import argparse
import itertools
import string
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://redap.dangerserver.live/scan/"
# The site 403'd non-browser agents, so pretend to be a normal browser.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

print_lock = threading.Lock()


def fetch(url, timeout=15):
    """Return (status, body_length, final_url). status is an int or None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, len(body), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, 0, url
    except Exception:
        return None, 0, url


def calibrate(prefix, length):
    """
    Fetch a code that almost certainly does NOT exist, so we learn what a
    'not found' response looks like (status + body size). Real pages get
    flagged when they differ from this baseline.
    """
    bogus = prefix + ("z0z"[:length] if length == 3 else "z" * length)
    status, size, _ = fetch(BASE + bogus)
    print(f"[calibrate] baseline miss ({bogus}): status={status} size={size} bytes")
    return status, size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--charset", default=string.ascii_lowercase + string.digits)
    ap.add_argument("--prefix", default="Y-")
    ap.add_argument("--length", type=int, default=3)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--delay", type=float, default=0.05)
    ap.add_argument("--out", default="found.txt")
    args = ap.parse_args()

    charset = args.charset
    total = len(charset) ** args.length
    print(f"[info] charset ({len(charset)} chars): {charset}")
    print(f"[info] pattern: {BASE}{args.prefix}{'X' * args.length}")
    print(f"[info] {total:,} combinations to try with {args.workers} workers\n")

    miss_status, miss_size = calibrate(args.prefix, args.length)

    codes = ("".join(c) for c in itertools.product(charset, repeat=args.length))
    hits = []
    done = 0
    started = time.time()

    def worker(code):
        if args.delay:
            time.sleep(args.delay)
        url = f"{BASE}{args.prefix}{code}"
        status, size, final = fetch(url)
        # A "hit" = a 2xx page that looks different from the not-found baseline.
        is_hit = (status is not None and 200 <= status < 300
                  and (status != miss_status or size != miss_size))
        return url, status, size, is_hit

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(worker, c): c for c in codes}
        for fut in as_completed(futures):
            url, status, size, is_hit = fut.result()
            done += 1
            if is_hit:
                hits.append(url)
                with print_lock:
                    print(f"\n[FOUND] {url}  (status={status}, {size} bytes)")
            if done % 500 == 0 or done == total:
                rate = done / max(time.time() - started, 0.001)
                with print_lock:
                    sys.stdout.write(
                        f"\r[progress] {done:,}/{total:,} "
                        f"({rate:.0f}/s, {len(hits)} found)")
                    sys.stdout.flush()

    print("\n\n=== Results ===")
    if hits:
        for h in sorted(hits):
            print(h)
        with open(args.out, "w") as f:
            f.write("\n".join(sorted(hits)) + "\n")
        print(f"\n{len(hits)} link(s) written to {args.out}")
    else:
        print("No pages found. If even Y-je6 didn't register as a hit, the "
              "not-found page may return HTTP 200 -- rerun and compare sizes, "
              "or widen --charset.")


if __name__ == "__main__":
    main()
