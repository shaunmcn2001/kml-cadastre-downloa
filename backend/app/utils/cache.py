import time
from typing import Optional, Any, Dict
from cachetools import TTLCache
import hashlib
import orjson
from .logging import get_logger

logger = get_logger(__name__)

class SimpleCache:
    """Simple TTL cache for API responses."""
    
    def __init__(self, max_size: int = 1000, ttl: int = 900):
        self.cache = TTLCache(maxsize=max_size, ttl=ttl)
        self.stats = {
            'hits': 0,
            'misses': 0,
            'sets': 0
        }
    
    def _make_key(self, data: Any) -> str:
        """Create cache key from data."""
        if isinstance(data, dict):
            # Sort dict for consistent hashing
            serialized = orjson.dumps(data, option=orjson.OPT_SORT_KEYS)
        else:
            serialized = orjson.dumps(data)
        
        return hashlib.sha256(serialized).hexdigest()[:16]
    
    def get(self, key: Any) -> Optional[Any]:
        """Get value from cache."""
        cache_key = self._make_key(key)
        
        try:
            value = self.cache[cache_key]
            self.stats['hits'] += 1
            logger.debug(f"Cache hit for key: {cache_key}")
            return value
        except KeyError:
            self.stats['misses'] += 1
            logger.debug(f"Cache miss for key: {cache_key}")
            return None
    
    def set(self, key: Any, value: Any) -> None:
        """Set value in cache."""
        cache_key = self._make_key(key)
        self.cache[cache_key] = value
        self.stats['sets'] += 1
        logger.debug(f"Cache set for key: {cache_key}")
    
    def clear(self) -> None:
        """Clear all cache entries."""
        self.cache.clear()
        logger.info("Cache cleared")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        total_requests = self.stats['hits'] + self.stats['misses']
        hit_rate = self.stats['hits'] / total_requests if total_requests > 0 else 0
        
        return {
            **self.stats,
            'hit_rate': hit_rate,
            'size': len(self.cache),
            'max_size': self.cache.maxsize
        }

# Global cache instance
_cache = None

def get_cache(ttl: int = 900, max_size: int = 1000) -> SimpleCache:
    """Get global cache instance."""
    global _cache
    if _cache is None:
        _cache = SimpleCache(max_size=max_size, ttl=ttl)
        logger.info(f"Initialized cache with TTL={ttl}s, max_size={max_size}")
    return _cache