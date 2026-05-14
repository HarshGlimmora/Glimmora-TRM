"""Smoke test for taxation engine.

Ensures that we can:
1. Seed rules.
2. Create a user and filing.
3. Add a salary transaction.
4. Compute tax under both regimes.
5. Verify basic numeric correctness.
"""

import uuid
import sys
import os

# Add the Backend directory to the python path so we can import app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from app.db.session import SessionLocal
from app.models.identity import User
from app.models.filing import TaxReturn
from app.models.documents import Transaction
from app.services.taxation.engine import compute_tax
from scripts.seed_taxation_rules import main as seed_rules

def smoke_test():
    # 1. Seed rules
    print("--- Step 1: Seeding rules ---")
    try:
        seed_rules()
    except Exception as e:
        print(f"Warning: Rule seeding failed (maybe already seeded): {e}")

    with SessionLocal() as db:
        print("--- Step 2: Creating test user ---")
        user_id = str(uuid.uuid4())
        user = User(
            id=user_id,
            email=f"smoke-test-{user_id[:8]}@example.com",
            password_hash="!smoke-test!",
            name="Smoke Test User",
            role="taxpayer",
            country="IN",
            phone=f"9{str(uuid.uuid4().int)[:9]}"
        )
        db.add(user)
        db.flush()
        
        print("--- Step 3: Creating test filing ---")
        filing_id = str(uuid.uuid4())
        filing = TaxReturn(
            id=filing_id,
            user_id=user_id,
            tax_year="FY2025-26",
            country="IN",
            status="draft",
            summary_json={"declared_deductions": {"80c": 150000}},
            tds_paid=0.0
        )
        db.add(filing)
        db.flush()
        
        print("--- Step 4: Adding salary transaction ---")
        salary_txn = Transaction(
            id=str(uuid.uuid4()),
            user_id=user_id,
            filing_id=filing_id,
            tax_year="FY2025-26",
            txn_date="2025-04-01",
            amount=1500000.0, # 15 Lakhs
            category="salary",
            categorization_method="manual",
            status="verified",
            description="Annual Salary"
        )
        db.add(salary_txn)
        
        db.commit()
        
        print(f"--- Step 5: Computing tax for filing {filing_id} (New Regime) ---")
        # Use overrides since User model is missing these fields
        result_new = compute_tax(
            db, 
            filing_id=filing_id, 
            regime="new", 
            residency_override="resident", 
            senior_override="<60"
        )
        print(f"New Regime Result:")
        print(f"  Gross Total Income: INR {result_new.gross_total_income}")
        print(f"  Taxable Income:     INR {result_new.taxable_income}")
        print(f"  Slab Tax:           INR {result_new.slab_tax}")
        print(f"  Rebate 87A:         INR {result_new.rebate_87a}")
        print(f"  Total Tax:          INR {result_new.total_tax}")
        
        print(f"\n--- Step 6: Computing tax for filing {filing_id} (Old Regime) ---")
        result_old = compute_tax(
            db, 
            filing_id=filing_id, 
            regime="old", 
            residency_override="resident", 
            senior_override="<60"
        )
        print(f"Old Regime Result:")
        print(f"  Gross Total Income: INR {result_old.gross_total_income}")
        print(f"  Deductions:         INR {result_old.deductions}")
        print(f"  Taxable Income:     INR {result_old.taxable_income}")
        print(f"  Slab Tax:           INR {result_old.slab_tax}")
        print(f"  Total Tax:          INR {result_old.total_tax}")
        
        # Validation
        print("\n--- Step 7: Validation ---")
        # For 15L in FY 2025-26 New Regime:
        # Standard deduction: 75,000
        # Income after SD: 1,425,000
        # Slabs: 0-4L: 0%, 4-8L: 5%, 8-12L: 10%, 12-16L: 15%
        # Tax: (400,000 * 0.05) + (400,000 * 0.10) + (225,000 * 0.15)
        # Tax: 20,000 + 40,000 + 33,750 = 93,750
        # Cess @ 4%: 93,750 * 0.04 = 3,750
        # Total: 93,750 + 3,750 = 97,500
        
        print(f"Expected New Regime Tax: ~INR 97,500, Got: INR {result_new.total_tax}")
        
        # For 15L in FY 2025-26 Old Regime:
        # Standard deduction: 50,000
        # 80C: 150,000
        # Total Income: 1,500,000 - 50,000 - 150,000 = 1,300,000
        # Slabs: 0-2.5L: 0, 2.5-5L: 12,500, 5-10L: 100,000, 10L+: (300,000 * 0.3) = 90,000
        # Total Slab Tax: 12,500 + 100,000 + 90,000 = 202,500
        # Cess @ 4%: 202,500 * 0.04 = 8,100
        # Total: 202,500 + 8,100 = 210,600
        
        print(f"Expected Old Regime Tax: ~INR 210,600, Got: INR {result_old.total_tax}")
        
        assert float(result_new.total_tax) == 97500.0
        assert float(result_old.total_tax) == 210600.0
        
        print("\nSmoke test passed successfully!")

if __name__ == "__main__":
    smoke_test()
