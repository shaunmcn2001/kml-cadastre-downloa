import time
from collections import defaultdict, deque
from typing import Dict, Any
from .logging import get_logger

logger = get_logger(__name__)

class RateLimiter:
    """Simple in-memory sliding window rate limiter."""
    
    def __init__(self, max_requests: int = 100, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, deque] = defaultdict(deque)
    
    def is_allowed(self, identifier: str) -> bool:
        """Check if request is allowed for the given identifier."""
        now = time.time()
        window_start = now - self.window_seconds
        
        # Clean old requests
        request_times = self.requests[identifier]
        while request_times and request_times[0] < window_start:
            request_times.popleft()
        
        # Check if under limit
        if len(request_times) >= self.max_requests:
            logger.warning(f"Rate limit exceeded for {identifier}")
            return False
        
        # Add current request
        request_times.append(now)
        return True
    
    def get_stats(self, identifier: str) -> Dict[str, Any]:
        """Get rate limit stats for identifier."""
        now = time.time()
        window_start = now - self.window_seconds
        
        request_times = self.requests[identifier]
        current_requests = sum(1 for t in request_times if t >= window_start)
        
        return {
            'current_requests': current_requests,
            'max_requests': self.max_requests,
            'window_seconds': self.window_seconds,
            'remaining': max(0, self.max_requests - current_requests)
        }

# Global rate limiter instance
_rate_limiter = None

def get_rate_limiter(max_requests: int = 100, window_seconds: int = 60) -> RateLimiter:
    """Get global rate limiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter(max_requests=max_requests, window_seconds=window_seconds)
        logger.info(f"Initialized rate limiter: {max_requests} requests per {window_seconds}s")
    return _rate_limiter