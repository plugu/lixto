-- Ticket 107: OCR for scanned/image-only editais.
--
-- `procurement_document_texts.method` gains 'ocr' — Tesseract text extracted
-- when pypdf's output was 'insufficient'. See src/lixto/enrich/documents.py
-- for the extraction pipeline and the chars=-1 "OCR already tried" marker.

ALTER TABLE procurement_document_texts DROP CONSTRAINT procurement_document_texts_method_check;
ALTER TABLE procurement_document_texts ADD CONSTRAINT procurement_document_texts_method_check
    CHECK (method IN ('pypdf','ocr','insufficient','not_pdf','failed'));
