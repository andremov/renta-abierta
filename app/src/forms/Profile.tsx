// The questionnaire that decides which pages apply.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Section, SegmentedControl, Text } from '@andremov/brand';
import { Button } from '@andremov/brand/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@andremov/brand/ui/collapsible';
import type { Session } from '../app/store';
import { QUESTIONS, type Question } from './pages';

export function ProfilePage({ session, onDone }: { session: Session; onDone: () => void }) {
  const common = QUESTIONS.filter((q) => !q.advanced);
  const advanced = QUESTIONS.filter((q) => q.advanced);
  // the collapsed questions are optional (unanswered counts as "no"), so only the visible ones are counted
  const answered = common.filter((q) => q.id in session.profile).length;
  const answeredAdvanced = advanced.filter((q) => q.id in session.profile).length;
  const [open, setOpen] = useState(() => advanced.some((q) => session.profile[q.id]));
  return (
    <div className="profile grid gap-5">
      <Text variant="title">Cuéntenos sobre su 2025</Text>
      <Text>
        Sus respuestas deciden qué secciones necesita diligenciar. Puede cambiarlas cuando quiera; lo que ya haya escrito no se
        pierde.
      </Text>
      <QuestionList qs={common} session={session} />
      <Collapsible open={open} onOpenChange={setOpen} className="grid gap-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-auto justify-start self-start px-2 py-1.5 whitespace-normal text-left">
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            <span>
              Situaciones menos comunes{' '}
              <Text as="span" variant="muted">
                (opcional{answeredAdvanced ? `, ${answeredAdvanced} respondidas` : '; si no las abre, cuentan como «No»'})
              </Text>
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <QuestionList qs={advanced} session={session} />
        </CollapsibleContent>
      </Collapsible>
      <div className="actions flex flex-wrap items-center gap-3">
        <Button onClick={onDone}>Continuar</Button>
        <Text as="span" variant="muted">
          {answered} de {common.length} preguntas respondidas
        </Text>
      </div>
    </div>
  );
}

type YesNo = 'si' | 'no';
const YES_NO = [
  { value: 'si' as YesNo, label: 'Sí' },
  { value: 'no' as YesNo, label: 'No' },
];

function QuestionList({ qs, session }: { qs: Question[]; session: Session }) {
  return (
    <ul className="grid gap-2">
      {qs.map((q) => {
        const v = session.profile[q.id];
        const value: YesNo | null = v === true ? 'si' : v === false ? 'no' : null;
        return (
          <li key={q.id}>
            <Section
              title={q.text}
              description={q.hint}
              // choosing the selected answer again clears it
              actions={
                <SegmentedControl
                  aria-label={q.text}
                  options={YES_NO}
                  value={value}
                  onChange={(o) => session.setAnswer(q.id, o === value ? null : o === 'si')}
                />
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
