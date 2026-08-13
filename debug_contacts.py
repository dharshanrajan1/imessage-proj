#!/usr/bin/env python3
"""Finds ALL AddressBook databases (including iCloud/Google sync sources)."""
import sqlite3, os, glob, re

base = os.path.expanduser('~/Library/Application Support/AddressBook')

print("=== All .abcddb files found ===")
all_dbs = []
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith('.abcddb'):
            full = os.path.join(root, f)
            size = os.path.getsize(full)
            all_dbs.append(full)
            print(f"  [{size:>10,} bytes]  {full}")

print(f"\nTotal DB files: {len(all_dbs)}")

total_contacts = 0
for db_path in all_dbs:
    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
        cur = conn.cursor()
        # Count actual person records
        cur.execute("SELECT COUNT(*) FROM ZABCDRECORD WHERE ZFIRSTNAME IS NOT NULL OR ZLASTNAME IS NOT NULL OR ZORGANIZATION IS NOT NULL")
        count = cur.fetchone()[0]
        if count > 0:
            print(f"\n  [{count} contacts] {db_path}")
            # Show sample
            cur.execute("""
                SELECT r.ZFIRSTNAME, r.ZLASTNAME, p.ZFULLNUMBER
                FROM ZABCDRECORD r
                LEFT JOIN ZABCDPHONENUMBER p ON r.Z_PK = p.ZOWNER
                WHERE (r.ZFIRSTNAME IS NOT NULL OR r.ZLASTNAME IS NOT NULL)
                AND p.ZFULLNUMBER IS NOT NULL
                LIMIT 5
            """)
            rows = cur.fetchall()
            for r in rows:
                name = ' '.join(filter(None, [r[0], r[1]]))
                print(f"    {name}: {r[2]}")
            total_contacts += count
        conn.close()
    except Exception as e:
        print(f"  [ERROR] {db_path}: {e}")

print(f"\n=== Total person records across all DBs: {total_contacts} ===")
