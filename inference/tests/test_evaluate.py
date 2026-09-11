from inference.evaluate import evaluate

def test_failed_attempts_remain_in_coverage_denominator():
    result=evaluate([
        {'participant':'a','reference_hr':'70','hr':'72','reference_rr':'15','rr':'14'},
        {'participant':'b','reference_hr':'70','hr':'','reference_rr':'15','rr':''}
    ])
    assert result['hr']['mae']==2 and result['rr']['mae']==1
    assert result['hr']['coverage']==.5 and not result['hr']['targetMet']
