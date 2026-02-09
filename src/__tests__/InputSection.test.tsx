import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InputSection } from '../components/InputSection';

describe('InputSection — Functional Tests', () => {
  let onAnalyze: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onAnalyze = vi.fn();
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
  });

  afterEach(() => { vi.useRealTimers(); });

  // Helper to get the submit button specifically
  const getSubmitButton = () => screen.getByRole('button', { name: /Analyze Meeting/i });

  // ===== MODE TABS =====
  describe('Mode Tabs', () => {
    it('should default to Live Record mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(screen.getByText('Start Recording')).toBeInTheDocument();
    });

    it('should switch to Upload File mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Upload File'));
      expect(screen.getByText('Drop audio or video file here')).toBeInTheDocument();
      expect(screen.queryByText('Start Recording')).not.toBeInTheDocument();
    });

    it('should switch to Paste Text mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Paste Text'));
      expect(screen.getByPlaceholderText('Paste your meeting transcript, notes, or context here...')).toBeInTheDocument();
      expect(screen.queryByText('Start Recording')).not.toBeInTheDocument();
      expect(screen.queryByText('Drop audio or video file here')).not.toBeInTheDocument();
    });

    it('should switch back to Live Record from other modes', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Paste Text'));
      fireEvent.click(screen.getByText('Live Record'));
      expect(screen.getByText('Start Recording')).toBeInTheDocument();
    });
  });

  // ===== LIVE RECORD MODE =====
  describe('Live Record Mode', () => {
    it('should show host name input', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(screen.getByPlaceholderText('e.g., Harish')).toBeInTheDocument();
    });

    it('should show participant roster input', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(screen.getByPlaceholderText('Add participant name...')).toBeInTheDocument();
    });

    it('should add a participant to the roster', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.change(screen.getByPlaceholderText('Add participant name...'), { target: { value: 'Sarah' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByText('Sarah')).toBeInTheDocument();
    });

    it('should not add empty participant (Add button disabled)', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    });

    it('should not add duplicate participant', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      const input = screen.getByPlaceholderText('Add participant name...');
      fireEvent.change(input, { target: { value: 'Sarah' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      fireEvent.change(input, { target: { value: 'Sarah' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getAllByText('Sarah').length).toBe(1);
    });

    it('should add participant on Enter key', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      const input = screen.getByPlaceholderText('Add participant name...');
      fireEvent.change(input, { target: { value: 'John' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(screen.getByText('John')).toBeInTheDocument();
    });

    it('should remove a participant when × clicked', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.change(screen.getByPlaceholderText('Add participant name...'), { target: { value: 'Sarah' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByText('Sarah')).toBeInTheDocument();
      fireEvent.click(screen.getByText('×'));
      expect(screen.queryByText('Sarah')).not.toBeInTheDocument();
    });

    it('should show how-it-works info box', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(screen.getByText(/How it works:/)).toBeInTheDocument();
    });

    it('should show Pause, Stop & Analyze, and Cancel during recording', async () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      await waitFor(async () => { fireEvent.click(screen.getByText('Start Recording')); });
      await waitFor(() => {
        expect(screen.getByText('Pause')).toBeInTheDocument();
        expect(screen.getByText('Stop & Analyze')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });
    });

    it('should show 3 channel status cards during recording', async () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      await waitFor(async () => { fireEvent.click(screen.getByText('Start Recording')); });
      await waitFor(() => {
        expect(screen.getByText('Your Mic')).toBeInTheDocument();
        expect(screen.getByText('Participants')).toBeInTheDocument();
        expect(screen.getByText('Screenshots')).toBeInTheDocument();
      });
    });

    it('should return to idle on Cancel during recording', async () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      await waitFor(async () => { fireEvent.click(screen.getByText('Start Recording')); });
      await waitFor(() => { expect(screen.getByText('Cancel')).toBeInTheDocument(); });
      fireEvent.click(screen.getByText('Cancel'));
      await waitFor(() => { expect(screen.getByText('Start Recording')).toBeInTheDocument(); });
    });

    it('should switch Pause to Resume on click', async () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      await waitFor(async () => { fireEvent.click(screen.getByText('Start Recording')); });
      await waitFor(() => { expect(screen.getByText('Pause')).toBeInTheDocument(); });
      fireEvent.click(screen.getByText('Pause'));
      await waitFor(() => {
        expect(screen.getByText('Resume')).toBeInTheDocument();
        expect(screen.queryByText('Pause')).not.toBeInTheDocument();
      });
    });

    it('should show recording result after Stop & Analyze', async () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      await waitFor(async () => { fireEvent.click(screen.getByText('Start Recording')); });
      await waitFor(() => { expect(screen.getByText('Stop & Analyze')).toBeInTheDocument(); });
      await waitFor(async () => { fireEvent.click(screen.getByText('Stop & Analyze')); });
      await waitFor(() => {
        expect(screen.getByText(/Recording ready/)).toBeInTheDocument();
        expect(screen.getByText('Discard & re-record')).toBeInTheDocument();
      });
    });

    it('should return to setup on Discard & re-record', async () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      await waitFor(async () => { fireEvent.click(screen.getByText('Start Recording')); });
      await waitFor(() => { expect(screen.getByText('Stop & Analyze')).toBeInTheDocument(); });
      await waitFor(async () => { fireEvent.click(screen.getByText('Stop & Analyze')); });
      await waitFor(() => { expect(screen.getByText('Discard & re-record')).toBeInTheDocument(); });
      fireEvent.click(screen.getByText('Discard & re-record'));
      await waitFor(() => { expect(screen.getByText('Start Recording')).toBeInTheDocument(); });
    });

    it('should enable Analyze Meeting after stop recording', async () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      await waitFor(async () => { fireEvent.click(screen.getByText('Start Recording')); });
      await waitFor(() => { expect(screen.getByText('Stop & Analyze')).toBeInTheDocument(); });
      await waitFor(async () => { fireEvent.click(screen.getByText('Stop & Analyze')); });
      await waitFor(() => { expect(getSubmitButton()).not.toBeDisabled(); });
    });
  });

  // ===== TEXT MODE =====
  describe('Text Mode', () => {
    it('should allow typing text', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Paste Text'));
      const ta = screen.getByPlaceholderText('Paste your meeting transcript, notes, or context here...');
      fireEvent.change(ta, { target: { value: 'Meeting notes' } });
      expect(ta).toHaveValue('Meeting notes');
    });

    it('should enable Analyze Meeting button when text is entered', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Paste Text'));
      fireEvent.change(screen.getByPlaceholderText('Paste your meeting transcript, notes, or context here...'), { target: { value: 'Hello' } });
      expect(getSubmitButton()).not.toBeDisabled();
    });

    it('should call onAnalyze with text on submit', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Paste Text'));
      fireEvent.change(screen.getByPlaceholderText('Paste your meeting transcript, notes, or context here...'), { target: { value: 'Notes' } });
      fireEvent.click(getSubmitButton());
      expect(onAnalyze).toHaveBeenCalledWith('Notes', null, []);
    });

    it('should show participant photos button in text mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Paste Text'));
      expect(screen.getByText('Add participant photos (optional)')).toBeInTheDocument();
    });
  });

  // ===== UPLOAD MODE =====
  describe('Upload Mode', () => {
    it('should show drop zone', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Upload File'));
      expect(screen.getByText('Drop audio or video file here')).toBeInTheDocument();
    });

    it('should show context textarea', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Upload File'));
      expect(screen.getByPlaceholderText('Add context, agenda, or notes (optional)...')).toBeInTheDocument();
    });

    it('should show participant photos button', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Upload File'));
      expect(screen.getByText('Add participant photos (optional)')).toBeInTheDocument();
    });
  });

  // ===== ANALYZE BUTTON STATE =====
  describe('Analyze Meeting Button', () => {
    it('should be disabled when no input in record mode (idle)', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(getSubmitButton()).toBeDisabled();
    });

    it('should be disabled when no input in text mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Paste Text'));
      expect(getSubmitButton()).toBeDisabled();
    });

    it('should be disabled when isProcessing is true even with text', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={true} />);
      fireEvent.click(screen.getByText('Paste Text'));
      fireEvent.change(screen.getByPlaceholderText('Paste your meeting transcript, notes, or context here...'), { target: { value: 'Text' } });
      expect(getSubmitButton()).toBeDisabled();
    });

    it('should NOT call onAnalyze when disabled', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(getSubmitButton());
      expect(onAnalyze).not.toHaveBeenCalled();
    });
  });

  // ===== CONTEXT TEXTAREA =====
  describe('Context Textarea', () => {
    it('should show in record mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(screen.getByPlaceholderText('Add context, agenda, or notes (optional)...')).toBeInTheDocument();
    });

    it('should NOT show participant photos in record mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      expect(screen.queryByText('Add participant photos (optional)')).not.toBeInTheDocument();
    });

    it('should show in upload mode', () => {
      render(<InputSection onAnalyze={onAnalyze} isProcessing={false} />);
      fireEvent.click(screen.getByText('Upload File'));
      expect(screen.getByPlaceholderText('Add context, agenda, or notes (optional)...')).toBeInTheDocument();
    });
  });
});
