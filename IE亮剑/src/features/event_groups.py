EVENT_GROUPS = {
    'road_risk': (11401, 11402, 11403, 11405, 11406),
    'stability': (30000, 30002, 30003, 30005, 30017),
    'fatigue': (41001, 41002, 41029),
    'distraction': (41003, 41004, 41005, 41009, 41023),
    'management': (41006, 41021),
    'blind_spot': (60292, 60294),
    'severe_history': (11803, 11804),
}
CODES = tuple(sorted(code for codes in EVENT_GROUPS.values() for code in codes))
assert len(CODES) == len(set(CODES)) == 24
SERIES = {**{f'evt_{code}': (code,) for code in CODES}, **EVENT_GROUPS}
LABEL_CODES = (11803, 11804)
