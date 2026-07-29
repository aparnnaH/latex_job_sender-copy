package com.applyflow.backend.service;

public class DocumentServiceException extends RuntimeException {

    private final String code;
    private final String safeMessage;
    private final boolean retryable;

    public DocumentServiceException(String code, String safeMessage, boolean retryable) {
        super(safeMessage);
        this.code = code;
        this.safeMessage = safeMessage;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public String safeMessage() {
        return safeMessage;
    }

    public boolean retryable() {
        return retryable;
    }
}
