import pytest
from app.parsers.nsw import parse_nsw
from app.models import ParcelState

class TestNSWParser:
    
    def test_simple_lot_plan_format(self):
        """Test simple LOT//PLAN format."""
        input_text = "1//DP131118\n2//DP131118"
        valid, malformed = parse_nsw(input_text)
        
        assert len(valid) == 2
        assert len(malformed) == 0
        
        assert valid[0].id == "1//DP131118"
        assert valid[0].state == ParcelState.NSW
        assert valid[0].lot == "1"
        assert valid[0].plan == "DP131118"
    
    def test_lot_token_format(self):
        """Test 'LOT 13 DP1242624' format."""
        input_text = "LOT 13 DP1242624"
        valid, malformed = parse_nsw(input_text)
        
        assert len(valid) == 1
        assert len(malformed) == 0
        
        assert valid[0].id == "13//DP1242624"
        assert valid[0].lot == "13"
        assert valid[0].plan == "DP1242624"
    
    def test_lot_section_plan_format(self):
        """Test LOT/SECTION//PLAN format."""
        input_text = "101/1//DP12345"
        valid, malformed = parse_nsw(input_text)
        
        assert len(valid) == 1
        assert len(malformed) == 0
        
        assert valid[0].id == "101/1//DP12345"
        assert valid[0].lot == "101"
        assert valid[0].section == "1"
        assert valid[0].plan == "DP12345"
    
    def test_range_expansion(self):
        """Test range expansion like 1-3//DP131118."""
        input_text = "1-3//DP131118"
        valid, malformed = parse_nsw(input_text)
        
        assert len(valid) == 3
        assert len(malformed) == 0
        
        expected_ids = ["1//DP131118", "2//DP131118", "3//DP131118"]
        actual_ids = [p.id for p in valid]
        assert actual_ids == expected_ids
    
    def test_invalid_format(self):
        """Test invalid format handling."""
        input_text = "invalid_format\n123INVALID"
        valid, malformed = parse_nsw(input_text)
        
        assert len(valid) == 0
        assert len(malformed) == 2
        
        assert "invalid_format" in malformed[0].raw
        assert "123INVALID" in malformed[1].raw
    
    def test_range_too_large(self):
        """Test range size limit."""
        input_text = "1-200//DP131118"  # Too large range
        valid, malformed = parse_nsw(input_text)
        
        assert len(valid) == 0
        assert len(malformed) == 1
        assert "too large" in malformed[0].error.lower()
    
    def test_mixed_valid_invalid(self):
        """Test mixed valid and invalid entries."""
        input_text = """1//DP131118
invalid_entry
LOT 13 DP1242624
another_invalid"""
        
        valid, malformed = parse_nsw(input_text)
        
        assert len(valid) == 2
        assert len(malformed) == 2