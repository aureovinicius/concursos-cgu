import unittest
from build_official import paper_family


class IdentityTests(unittest.TestCase):
    def test_reference_number_never_replaces_matched_booklet(self):
        paper = {'codes':[{'raw':'800-61','evidence':'pdf'}], 'matchedCode':{'raw':'658_PETROBRAS_004_01'}}
        self.assertEqual(paper_family(paper), '658_PETROBRAS_004')
        paper['matchedCode']['raw'] = '658_PETROBRAS_005_01'
        self.assertEqual(paper_family(paper), '658_PETROBRAS_005')

    def test_matrix_and_regular_booklets_remain_distinct(self):
        matrix = paper_family({'matchedCode':{'raw':'MATRIX424BNB001','matrix':True}})
        regular = paper_family({'matchedCode':{'raw':'424_BNB_001_01'}})
        self.assertNotEqual(matrix, regular)
        self.assertEqual(matrix, 'MATRIX424BNB001')

    def test_accessible_edition_belongs_to_same_family(self):
        regular = paper_family({'matchedCode':{'raw':'375_STM_CB3_01'}})
        accessible = paper_family({'matchedCode':{'raw':'375_STM_CB3_03_SUPER'}})
        self.assertEqual(regular, accessible)


if __name__ == '__main__':
    unittest.main()
