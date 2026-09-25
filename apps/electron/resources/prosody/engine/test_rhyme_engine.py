"""Dictionary-backed regressions; run with the installed prosody Python runtime."""
import unittest
from unittest.mock import patch
import rhyme_engine as engine


class RhymeEngineTests(unittest.TestCase):
    def test_enough_keeps_short_perfect_rhymes_without_a_syllable_filter(self):
        self.assertTrue({'rough', 'tough', 'stuff'} <= set(engine.perfect('enough')))
        self.assertFalse({'rough', 'tough', 'stuff'} & set(engine.perfect('enough', want_syll=2)))

    def test_enough_rejects_weak_unstressed_endings(self):
        words = {item[1] for item in engine.slant('enough', max_n=1000)}
        self.assertFalse({'sheriff', 'plaintiff', 'tariff', 'joseph'} & words)
        self.assertTrue({'love', 'above'} <= words)

    def test_town_keeps_close_cluster_matches_without_generic_n_endings(self):
        words = {item[1] for item in engine.slant('town', max_n=1000)}
        self.assertTrue({'sound', 'found', 'ground', 'count'} <= words)
        self.assertFalse({'in', 'on', 'an', 'one', 'when', 'county'} & words)

    def test_unrelated_vowels_are_not_the_same_consonant_manner(self):
        self.assertEqual(engine.coda_score(['AA'], ['IY']), 0)
        self.assertLess(engine.tail_sim(['AA'], ['IY']), 0)
        self.assertIsNone(engine.slant_score(engine.anchors('T AW1 N'), engine.anchors('W AH1 N')))

    def test_alternate_read_pronunciations_are_perfect_and_never_slant(self):
        perfect = engine.perfect('read', max_n=1000, min_freq=0)
        self.assertTrue({'red', 'reed'} <= set(perfect))
        self.assertEqual(len(perfect), len(set(perfect)))
        slants = [item[1] for item in engine.slant('read', max_n=1000)]
        self.assertFalse({'red', 'reed'} & set(slants))
        self.assertEqual(len(slants), len(set(slants)))

    def test_secondary_stress_is_a_perfect_match_not_a_slant(self):
        self.assertIn('breakdown', engine.perfect('town', max_n=1000))
        self.assertNotIn('breakdown', {item[1] for item in engine.slant('town', max_n=1000)})

    def test_syllable_filter_uses_matching_reading_not_first_reading(self):
        with patch.object(engine, 'perfect_matches', return_value={
            'example': {'AH0 B AH1 F', 'AH1 F'},
        }), patch.object(engine, 'freq', return_value=5):
            self.assertEqual(engine.perfect('enough', want_syll=1), ['example'])
            self.assertEqual(engine.perfect('enough', want_syll=3), [])

    def test_slant_considers_alternate_candidate_and_keeps_best_once(self):
        with patch.object(engine, 'all_words', return_value={
            'candidate': ('SH EH1 R AH0 F', 'L AH1 V'),
        }), patch.object(engine, 'perfect_matches', return_value={}), patch.object(engine, 'freq', return_value=5):
            results = engine.slant('enough')
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0][1:4], ('candidate', 1, '1'))


if __name__ == '__main__':
    unittest.main()
