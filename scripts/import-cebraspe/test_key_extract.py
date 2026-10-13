import unittest
from key_extract import parse_rows,extract_codes
class KeyParsingTests(unittest.TestCase):
 def test_packed_sequence(self):
  a,_,c=parse_rows('1 23456789 1 0 1 1 1 2 1 3 1 4 1 5 1 6 1 7 1 8 1 9 2 0\nC CEECEECCEEXCC E CE C EC')
  self.assertEqual(len(a),20); self.assertEqual(a['12'],'X');self.assertFalse(c)
 def test_zero_fillers(self):
  a,_,_=parse_rows('111 112 113 114 115 116 117 118 119 120 0 0 0 000 000 0\nC EECECCEEC 0 0 0 000 000 0')
  self.assertEqual(len(a),10); self.assertEqual(a['111'],'C');self.assertEqual(a['120'],'C')
 def test_mismatch_rejected(self):
  self.assertFalse(parse_rows('1 2 3 4 5\nC E C E')[0])
 def test_vertical(self):
  a,_,_=parse_rows('1 C 41 E 81 X\n2 A 42 D 82 B')
  self.assertEqual(a,{'1':'C','2':'A','41':'E','42':'D','81':'X','82':'B'})
 def test_code_variant_preserved(self):
  a=extract_codes('846_SERPRO_23_CB1_01')[0]['normalized']; b=extract_codes('846_SERPRO_23_CB1_09_ADAPTADA')[0]['normalized']
  self.assertNotEqual(a,b)
 def test_code_basic_distinct(self):
  self.assertNotEqual(extract_codes('018_STJ_CB3_01')[0]['normalized'],extract_codes('018_STJ_003_01')[0]['normalized'])
 def test_descriptive_suffix_keeps_variant(self):
  self.assertEqual(extract_codes('378_ABIN_CB1_010_SUPER')[0]['normalized'],'378ABINCB1010')
  self.assertEqual(extract_codes('424_BNB_CB1_00_MATRIZ')[0]['normalized'],'424BNBCB100')
  self.assertNotEqual(extract_codes('424_BNB_CB1_00_MATRIZ')[0]['normalized'],extract_codes('424_BNB_CB1_01')[0]['normalized'])
 def test_explicit_matrix_identity(self):
  a={x['normalized'] for x in extract_codes('MATRIZ_424_BNB001__PAG_5')}
  b={x['normalized'] for x in extract_codes('GAB_DEFINITIVO_424_BNB_001_00_MATRIZ')}
  self.assertEqual(a & b,{'MATRIX424BNB001'})
 def test_matrix_not_numbered_booklet(self):
  a={x['normalized'] for x in extract_codes('MATRIZ_424_BNB001__PAG_5')}
  b={x['normalized'] for x in extract_codes('GAB_DEFINITIVO_424_BNB_001_01')}
  self.assertFalse(a & b)
if __name__=='__main__':unittest.main()
