import os,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import exam_extract as e
ARCHIVE=Path(os.environ.get('CEBRASPE_ARCHIVE',str(Path(__file__).resolve().parents[2]/'research'/'cebraspe-ti')))

class ExtractionTests(unittest.TestCase):
    def test_reading_passage_left_column_is_not_interleaved(self):
        d=e.extract_exam(ARCHIVE/'pdfs/STJ_24/018_STJ_CB3_01.PDF')
        self.assertEqual([q['number'] for q in d['questions']],list(range(1,51)))
        q=d['questions'][0]
        self.assertEqual(q['column'],1)
        self.assertIn('Mantendo-se a correção',q['text'])
        self.assertNotIn('Independência dos Estados',q['text'])
        self.assertIn('Por quase dois séculos',q['context'])
        self.assertTrue(q['visualRequired'])

    def test_ce_numbers_and_shared_prompt_at_column_boundary(self):
        d=e.extract_exam(ARCHIVE/'pdfs/STJ_24/018_STJ_003_01.PDF')
        self.assertEqual([q['number'] for q in d['questions']],list(range(51,121)))
        qs={q['number']:q for q in d['questions']}
        self.assertIn('Kanban',qs[51]['context'])
        self.assertNotIn('162/2021',qs[59]['text'])
        self.assertIn('162/2021',qs[60]['context'])

    def test_multiple_choice_has_observed_options(self):
        d=e.extract_exam(ARCHIVE/'pdfs/AGER_MT_23/813_AGER_MT_CB1_01.PDF')
        self.assertEqual(d['type'],'multiple')
        self.assertEqual([a['letter'] for a in d['questions'][0]['alternatives']],list('ABCDE'))
        self.assertIn('Conforme as ideias',d['questions'][0]['text'])

    def test_graphical_alternative_e_at_end_of_transcription(self):
        d=e.extract_exam(ARCHIVE/'pdfs/TRE_BA_17/329_TREBA_004_01.PDF')
        q=next(q for q in d['questions'] if q['number']==27)
        self.assertEqual([a['letter'] for a in q['alternatives']],list('ABCDE'))

    def test_formula_only_statement_number_is_preserved(self):
        d=e.extract_exam(ARCHIVE/'pdfs/BCB_24/959_BCB_CB1_01.PDF')
        self.assertEqual([q['number'] for q in d['questions']],list(range(1,51)))
        self.assertEqual(next(q for q in d['questions'] if q['number']==27)['page'],2)

    def test_legacy_ce_preserves_code_in_canonical_page(self):
        d=e.extract_exam(ARCHIVE/'legacy/funpresp_15/bd5e207a32-232FUNPRESPEXE_008_01.pdf')
        self.assertEqual([q['number'] for q in d['questions']],list(range(51,121)))
        self.assertEqual(d['questions'][4]['sourcePages'],[1])
        self.assertTrue(d['questions'][4]['visualRequired'])

    def test_answer_pages_detected(self):
        self.assertEqual(e.unsafe_page_reason('GABARITOS OFICIAIS DEFINITIVOS\nQuestão 1 2'),'answer-key-page')
        self.assertEqual(e.unsafe_page_reason('PROVA DISCURSIVA\ntexto'),'discursive-only-page')
        self.assertEqual(e.unsafe_page_reason('||D|| - Correta. Comentário.'),'embedded-answer-commentary')
        self.assertEqual(e.unsafe_page_reason('GABARITO: E'),'embedded-answer-commentary')
        self.assertIsNone(e.unsafe_page_reason('Use a folha de respostas.'))

    def test_verified_legacy_digit_encoding(self):
        d=e.extract_exam(ARCHIVE/'legacy/dataprev2006/25a5258ab7-DATAPREV_006_8.pdf')
        self.assertEqual([q['number'] for q in d['questions']],list(range(1,121)))
        self.assertEqual(next(q for q in d['questions'] if q['number']==8)['page'],3)

    def test_consecutive_items_beat_passage_line_numbers(self):
        def marker(n,y,different=True):return {'number':n,'page':0,'column':0,'bbox':[28,y,34,y+8],'explicit':False,'fontDifferent':different}
        pages=[{'candidates':[marker(1,40,False),marker(4,70,False),marker(7,100,False)]+[marker(n,200+n*20) for n in range(1,8)]}]
        selected,_=e.select_markers(pages)
        self.assertEqual([m['number'] for m in selected],list(range(1,8)))
        self.assertEqual(selected[0]['bbox'][1],220)

    def test_final_question_can_continue_on_following_page(self):
        row=lambda t,y:{'text':t,'bbox':[40,y,100,y+10]}
        pages=[{'columns':[{'rows':[row('last item',100)]}]},{'columns':[{'rows':[row('continued',50)]}]}]
        rows=e.rows_between(pages,{'page':0,'column':0,'bbox':[20,100,30,108]},None)
        self.assertEqual([r['text'] for r in rows],['last item','continued'])

if __name__=='__main__':unittest.main()
