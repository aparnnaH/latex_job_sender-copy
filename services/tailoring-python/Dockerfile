FROM python:3.12-slim

WORKDIR /app

COPY tailor_resume.py tailoring_service.py ./

EXPOSE 8000

CMD ["python3", "tailoring_service.py", "--host", "0.0.0.0", "--port", "8000"]
