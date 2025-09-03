import logging
import sys
from typing import Dict, Any
import orjson

def setup_logging(level: str = "INFO") -> None:
    """Setup structured JSON logging."""
    
    class JSONFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            log_data = {
                'timestamp': self.formatTime(record),
                'level': record.levelname,
                'logger': record.name,
                'message': record.getMessage(),
                'module': record.module,
                'function': record.funcName,
                'line': record.lineno
            }
            
            # Add exception info if present
            if record.exc_info:
                log_data['exception'] = self.formatException(record.exc_info)
            
            # Add extra fields from record
            for key, value in record.__dict__.items():
                if key not in ('name', 'msg', 'args', 'levelname', 'levelno', 'pathname',
                              'filename', 'module', 'lineno', 'funcName', 'created',
                              'msecs', 'relativeCreated', 'thread', 'threadName',
                              'processName', 'process', 'getMessage', 'exc_info',
                              'exc_text', 'stack_info'):
                    log_data[key] = value
            
            return orjson.dumps(log_data).decode()
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))
    
    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Add JSON handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root_logger.addHandler(handler)

def get_logger(name: str) -> logging.Logger:
    """Get a logger instance."""
    return logging.getLogger(name)