def stub_list_response(entity: str) -> dict:
    return {
        "data": [],
        "meta": {"source": "api"},
        "todo": f"TODO[PENDING_DEPENDENCY]: {entity} endpoints are not implemented yet.",
    }


def stub_detail_response(entity: str) -> dict:
    return {
        "data": None,
        "meta": {"source": "api"},
        "todo": f"TODO[PENDING_DEPENDENCY]: {entity} endpoint is not implemented yet.",
    }
